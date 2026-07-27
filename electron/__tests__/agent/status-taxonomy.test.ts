import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  RUNNING_STATUSES,
  PAUSED_STATUSES,
  TERMINAL_STATUSES,
  NON_RUNNING_STATUSES,
} from '../../ipc/agent/types';

/**
 * The status taxonomy is the contract behind concurrency accounting and startup
 * reconciliation. A status written by the orchestrator but missing from every list
 * is counted as active forever and never requeued after a crash — on the free tier
 * (max_concurrent = 1) a single such row blocks every project permanently.
 *
 * This happened with 'fixing'. The test scans the source so a new status cannot be
 * introduced without being classified.
 */

const AGENT_DIR = join(__dirname, '../../ipc/agent');

function statusesWrittenInSource(): Set<string> {
  const found = new Set<string>();
  const files = readdirSync(AGENT_DIR).filter((f) => f.endsWith('.ts'));

  for (const file of files) {
    const src = readFileSync(join(AGENT_DIR, file), 'utf-8');

    // q.updateTaskStatus.run('some_status', ...)
    for (const m of src.matchAll(/updateTaskStatus\.run\(\s*'([a-z_]+)'/g)) {
      found.add(m[1]);
    }
    // q.patchTask(taskId, { ... status: 'some_status' ... })
    // Scoped to patchTask so it doesn't pick up sendPhaseUpdate's phase status
    // ('started' / 'paused' / 'completed'), which is a different vocabulary.
    for (const call of src.matchAll(/patchTask\([^)]*?\{([^}]*)\}/gs)) {
      const statusField = call[1].match(/status:\s*'([a-z_]+)'/);
      if (statusField) found.add(statusField[1]);
    }
  }
  return found;
}

describe('task status taxonomy', () => {
  const classified = new Set<string>([
    ...RUNNING_STATUSES,
    ...PAUSED_STATUSES,
    ...TERMINAL_STATUSES,
  ]);

  it('classifies every status the agent layer writes', () => {
    const written = statusesWrittenInSource();
    expect(written.size).toBeGreaterThan(5); // guard against the scan silently matching nothing

    const unclassified = [...written].filter((s) => !classified.has(s));
    expect(unclassified, `unclassified status(es): ${unclassified.join(', ')}`).toEqual([]);
  });

  it('includes the quality-gate fix status as running', () => {
    // Regression: 'fixing' was written by Phase 3 but absent from every list.
    expect(RUNNING_STATUSES).toContain('fixing');
  });

  it('keeps the three classes disjoint', () => {
    const all = [...RUNNING_STATUSES, ...PAUSED_STATUSES, ...TERMINAL_STATUSES];
    expect(all.length).toBe(new Set(all).size);
  });

  it('derives NON_RUNNING_STATUSES as the complement of RUNNING_STATUSES', () => {
    for (const s of NON_RUNNING_STATUSES) {
      expect(RUNNING_STATUSES).not.toContain(s);
    }
    expect(NON_RUNNING_STATUSES.length).toBe(PAUSED_STATUSES.length + TERMINAL_STATUSES.length);
  });
});
