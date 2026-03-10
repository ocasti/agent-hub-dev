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
