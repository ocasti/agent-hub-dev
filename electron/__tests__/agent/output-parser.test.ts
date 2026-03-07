import { describe, it, expect } from 'vitest';
import { parsePhaseOutput, extractField } from '../../ipc/agent/output-parser';

describe('parsePhaseOutput', () => {
  describe('Phase 0 — Spec Review', () => {
    it('should detect [SPEC_OK]', () => {
      const result = parsePhaseOutput(0, 'Analysis complete.\n[SPEC_OK]');
      expect(result.specOk).toBe(true);
      expect(result.specIncomplete).toBe(false);
    });

    it('should detect [SPEC_INCOMPLETE] with suggestions', () => {
      const output = `The spec is ambiguous.
[SPEC_INCOMPLETE]
[SUGGESTION] Add error handling requirements
[SUGGESTION] Specify expected response format`;
      const result = parsePhaseOutput(0, output);
      expect(result.specIncomplete).toBe(true);
      expect(result.suggestions).toEqual([
        'Add error handling requirements',
        'Specify expected response format',
      ]);
    });

    it('should return empty suggestions if none present', () => {
      const result = parsePhaseOutput(0, '[SPEC_INCOMPLETE]');
      expect(result.suggestions).toEqual([]);
    });
  });

  describe('Phase 3 — Quality Gate', () => {
    it('should detect [REVIEW_PASS]', () => {
      const result = parsePhaseOutput(3, 'All checks passed.\n[REVIEW_PASS]');
      expect(result.reviewPass).toBe(true);
      expect(result.reviewIssues).toBe(false);
    });

    it('should parse [ISSUE] entries', () => {
      const output = `[REVIEW_ISSUES]
[ISSUE] security: SQL injection risk in handler
[ISSUE] testing: Missing edge case test`;
      const result = parsePhaseOutput(3, output);
      expect(result.reviewIssues).toBe(true);
      expect(result.issues).toHaveLength(2);
      expect(result.issues![0]).toEqual({ category: 'security', description: 'SQL injection risk in handler' });
      expect(result.issues![1]).toEqual({ category: 'testing', description: 'Missing edge case test' });
    });

    it('should parse [KNOWLEDGE_ENTRY] blocks', () => {
      const output = `[REVIEW_PASS]
[KNOWLEDGE_ENTRY]
category: security
severity: high
title: Always sanitize inputs
description: User inputs must be sanitized before DB queries
anti_pattern: Direct string interpolation in SQL
[/KNOWLEDGE_ENTRY]`;
      const result = parsePhaseOutput(3, output);
      expect(result.knowledgeEntries).toHaveLength(1);
      expect(result.knowledgeEntries![0].category).toBe('security');
      expect(result.knowledgeEntries![0].severity).toBe('high');
      expect(result.knowledgeEntries![0].title).toBe('Always sanitize inputs');
      expect(result.knowledgeEntries![0].antiPattern).toBe('Direct string interpolation in SQL');
    });

    it('should parse [CRITERION_STATUS] blocks', () => {
      const output = `[REVIEW_PASS]
[CRITERION_STATUS]
index: 1
met: true
note: Implemented via UserService.validate()
[/CRITERION_STATUS]
[CRITERION_STATUS]
index: 2
met: false
note: Missing test for empty input
[/CRITERION_STATUS]`;
      const result = parsePhaseOutput(3, output);
      expect(result.criteriaStatus).toHaveLength(2);
      expect(result.criteriaStatus![0]).toEqual({ index: 1, met: true, note: 'Implemented via UserService.validate()' });
      expect(result.criteriaStatus![1]).toEqual({ index: 2, met: false, note: 'Missing test for empty input' });
    });

    it('should parse [RESOLVED_THREAD] markers', () => {
      const output = `[RESOLVED_THREAD:abc123]
[RESOLVED_THREAD:def456]
[REVIEW_PASS]`;
      const result = parsePhaseOutput(3, output);
      expect(result.resolvedThreadIds).toEqual(['abc123', 'def456']);
    });

    it('should parse [THREAD_REPLY] blocks', () => {
      const output = `[THREAD_REPLY:abc123]
The current approach is correct because it handles edge cases.
[/THREAD_REPLY]
[REVIEW_PASS]`;
      const result = parsePhaseOutput(3, output);
      expect(result.threadReplies).toHaveLength(1);
      expect(result.threadReplies![0].threadId).toBe('abc123');
      expect(result.threadReplies![0].body).toBe('The current approach is correct because it handles edge cases.');
    });
  });

  describe('Phase 4 — Ship', () => {
    it('should parse [PR_NUMBER] and [BRANCH]', () => {
      const output = `PR created successfully.
[PR_NUMBER:42]
[BRANCH:feature/0001-add-auth]`;
      const result = parsePhaseOutput(4, output);
      expect(result.prNumber).toBe(42);
      expect(result.branchName).toBe('feature/0001-add-auth');
    });

    it('should handle missing PR number gracefully', () => {
      const result = parsePhaseOutput(4, 'No PR created.');
      expect(result.prNumber).toBeUndefined();
      expect(result.branchName).toBeUndefined();
    });
  });
});

describe('extractField', () => {
  it('should extract a field value from a block', () => {
    const block = 'category: security\nseverity: high\ntitle: My Title';
    expect(extractField(block, 'category')).toBe('security');
    expect(extractField(block, 'severity')).toBe('high');
    expect(extractField(block, 'title')).toBe('My Title');
  });

  it('should return undefined for missing fields', () => {
    expect(extractField('category: testing', 'severity')).toBeUndefined();
  });

  it('should be case-insensitive', () => {
    expect(extractField('Category: TESTING', 'category')).toBe('TESTING');
  });
});
