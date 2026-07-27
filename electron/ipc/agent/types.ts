import type { BrowserWindow } from 'electron';
import type { createQueries } from '../../db/queries';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TaskRow {
  id: string;
  project_id: string;
  project_name: string;
  project_path: string;
  project_description: string | null;
  title: string;
  description: string;
  acceptance_criteria: string;
  images: string;
  model: string;
  status: string;
  pr_number: number | null;
  review_cycle: number;
  spec_suggestions: string;
  plan_summary: string | null;
  branch_name: string | null;
  last_phase: number;
  criteria_status: string;
  pm_work_item_id: string | null;
  pm_work_item_url: string | null;
  worktree_path: string | null;
  plugin_context: string;
}

export interface KnowledgeRow {
  id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  code_example: string | null;
  anti_pattern: string | null;
}

export interface ParsedResult {
  specOk?: boolean;
  specIncomplete?: boolean;
  suggestions?: string[];
  reviewPass?: boolean;
  reviewIssues?: boolean;
  issues?: { category: string; description: string }[];
  prNumber?: number;
  branchName?: string;
  knowledgeEntries?: { category: string; severity: string; title: string; description: string; codeExample?: string; antiPattern?: string }[];
  resolvedThreadIds?: string[];
  threadReplies?: { threadId: string; body: string }[];
  criteriaStatus?: { index: number; met: boolean; note?: string }[];
}

export type Queries = ReturnType<typeof createQueries>;

export interface FetchedThread {
  id: string;
  file: string;
  line: number | null;
  diffHunk: string | null;
  comments: { author: string; body: string }[];
}

export interface FetchedPrFeedback {
  generalComments: string;
  threads: FetchedThread[];
}

export interface AnalysisResult {
  shortDescription: string;  // 1-2 sentences for DB
  agentMdContent: string;    // Full AGENT.md content
}

export type ThreadPromptInput =
  | { type: 'general'; content: string }
  | { type: 'thread'; thread: FetchedThread };

export type GetWindow = () => BrowserWindow | null;

// ── CI / Pipeline Status ────────────────────────────────────────────────────────

export type CIStatus = 'pass' | 'fail' | 'pending' | 'unknown';

export interface CICheckResult {
  status: CIStatus;
  /** Summary line, e.g. "3/5 checks passed, 2 failed" */
  summary: string;
  /** Failure logs from failed runs (truncated) */
  failureLogs?: string;
  /** Names of checks still running (when status is 'pending') */
  pendingChecks?: string[];
}

// Phase number → task status mapping
export const PHASE_STATUS: Record<number, string> = {
  0: 'spec_review',
  1: 'planning',
  2: 'implementing',
  3: 'reviewing',
  4: 'shipping',
};

export const PHASE_LABELS: Record<number, string> = {
  0: 'spec_review',
  1: 'planning',
  2: 'implementing',
  3: 'reviewing',
  4: 'shipping',
  5: 'pr_feedback',
};

// ── Task status taxonomy ───────────────────────────────────────────────────────
// Single source of truth. These lists were previously inlined in several queries
// and components, and drifted: a status added to one list and missed in another
// leaves tasks either invisible to the queue or permanently counted as running.

/**
 * A workflow is actively executing — occupies a concurrency slot.
 *
 * Every status an agent phase can leave behind must be listed here, or a crash
 * during that phase leaves the row counted as active forever: startup
 * reconciliation skips it and the concurrency counter never frees the slot.
 * On the free tier (max_concurrent = 1) one such row blocks every project.
 */
export const RUNNING_STATUSES = [
  'spec_review', 'planning', 'implementing', 'reviewing', 'fixing', 'shipping', 'pr_fixing',
] as const;

/** Waiting on the user or on an external event — does NOT occupy a slot. */
export const PAUSED_STATUSES = [
  'queued', 'spec_feedback', 'plan_review', 'pr_feedback', 'push_review', 'test_fixing',
] as const;

/** Finished, successfully or not. */
export const TERMINAL_STATUSES = ['completed', 'failed'] as const;

/** Statuses that mean "not running", for `NOT IN (...)` style checks. */
export const NON_RUNNING_STATUSES: readonly string[] = [
  ...PAUSED_STATUSES, ...TERMINAL_STATUSES,
];
