import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createQueries } from '../../db/queries';

/**
 * `patchTask` replaced the 14-argument positional `updateTask` statement, whose
 * call sites had drifted — one passed 12 values and threw at runtime whenever a
 * user edited a spec and continued.
 */

type RunArgs = Record<string, unknown>;

function makeDb() {
  const runs: { sql: string; args: RunArgs }[] = [];
  const db = {
    prepare: vi.fn((sql: string) => ({
      run: (args: RunArgs) => {
        runs.push({ sql, args });
        return { changes: 1 };
      },
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
  };
  return { db: db as never, runs, prepare: db.prepare };
}

describe('patchTask', () => {
  let ctx: ReturnType<typeof makeDb>;
  let q: ReturnType<typeof createQueries>;

  beforeEach(() => {
    ctx = makeDb();
    q = createQueries(ctx.db);
    ctx.runs.length = 0;
  });

  it('updates only the columns provided', () => {
    q.patchTask('task-1', { status: 'queued', plan_summary: null });

    expect(ctx.runs).toHaveLength(1);
    expect(ctx.runs[0].sql).toContain('status=@status');
    expect(ctx.runs[0].sql).toContain('plan_summary=@plan_summary');
    expect(ctx.runs[0].sql).not.toContain('title=');
    expect(ctx.runs[0].args).toEqual({ id: 'task-1', status: 'queued', plan_summary: null });
  });

  it('always bumps updated_at and targets the given task', () => {
    q.patchTask('task-2', { branch_name: 'feature/0001-x' });

    expect(ctx.runs[0].sql).toContain('updated_at=CURRENT_TIMESTAMP');
    expect(ctx.runs[0].sql).toContain('WHERE id=@id');
    expect(ctx.runs[0].args.id).toBe('task-2');
  });

  it('ignores columns outside the allow-list', () => {
    q.patchTask('task-3', { id: 'other', created_at: 'x' } as never);
    expect(ctx.runs).toHaveLength(0);
  });

  it('is a no-op for an empty patch', () => {
    q.patchTask('task-4', {});
    expect(ctx.runs).toHaveLength(0);
  });

  it('accepts every field the spec-edit resume path needs', () => {
    // The exact combination that used to throw RangeError: Too few parameter values.
    q.patchTask('task-5', {
      description: 'edited spec',
      status: 'queued',
      spec_suggestions: '[]',
      plan_summary: null,
    });

    expect(ctx.runs).toHaveLength(1);
    expect(Object.keys(ctx.runs[0].args).sort()).toEqual(
      ['description', 'id', 'plan_summary', 'spec_suggestions', 'status']
    );
  });
});
