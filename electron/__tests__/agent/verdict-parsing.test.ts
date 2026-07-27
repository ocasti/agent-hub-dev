import { describe, it, expect } from 'vitest';
import { parsePhaseOutput, verdictRegion } from '../../ipc/agent/output-parser';

/**
 * Regression tests for verdict detection.
 *
 * Phase prompts embed the marker names in their "Required Output Format" section,
 * and agents restate their instructions. Scanning the whole transcript for a marker
 * therefore reported verdicts the agent never gave.
 */
describe('verdictRegion', () => {
  it('returns the whole output when it is short', () => {
    expect(verdictRegion('[REVIEW_PASS]')).toBe('[REVIEW_PASS]');
  });

  it('keeps only the tail of a long transcript', () => {
    const long = 'x'.repeat(10_000) + '[REVIEW_PASS]';
    const region = verdictRegion(long);
    expect(region).toContain('[REVIEW_PASS]');
    expect(region.length).toBeLessThan(long.length);
  });
});

describe('parsePhaseOutput — phase 3 verdict', () => {
  it('reports a pass when the marker is the final verdict', () => {
    const result = parsePhaseOutput(3, 'Ran the suite, everything is green.\n[REVIEW_PASS]');
    expect(result.reviewPass).toBe(true);
    expect(result.reviewIssues).toBe(false);
  });

  it('does not report a pass when the marker only appears in echoed instructions', () => {
    const echoedPrompt = 'I will end my response with [REVIEW_PASS] if no issues are found.';
    const crashNoise = 'y'.repeat(10_000);
    const result = parsePhaseOutput(3, `${echoedPrompt}\n${crashNoise}`);
    expect(result.reviewPass).toBe(false);
  });

  it('fails closed when the agent emits both verdicts', () => {
    const result = parsePhaseOutput(3, '[ISSUE] security: missing nonce\n[REVIEW_ISSUES]\n[REVIEW_PASS]');
    expect(result.reviewPass).toBe(false);
    expect(result.reviewIssues).toBe(true);
  });

  it('still collects issue entries from the verdict region', () => {
    const result = parsePhaseOutput(3, '[ISSUE] security: missing nonce check\n[REVIEW_ISSUES]');
    expect(result.issues).toHaveLength(1);
    expect(result.issues?.[0]).toEqual({ category: 'security', description: 'missing nonce check' });
  });
});

describe('parsePhaseOutput — phase 0 verdict', () => {
  it('treats an incomplete spec as authoritative over an OK marker', () => {
    const result = parsePhaseOutput(0, '[SPEC_INCOMPLETE]\n[SUGGESTION] Define the error states\n[SPEC_OK]');
    expect(result.specIncomplete).toBe(true);
    expect(result.specOk).toBe(false);
    expect(result.suggestions).toEqual(['Define the error states']);
  });

  it('reports spec OK when that is the only verdict', () => {
    const result = parsePhaseOutput(0, 'Spec looks complete.\n[SPEC_OK]');
    expect(result.specOk).toBe(true);
    expect(result.specIncomplete).toBe(false);
  });
});
