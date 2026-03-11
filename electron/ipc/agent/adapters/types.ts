// ── Code Hosting Adapter Types ──────────────────────────────────────────────────
//
// Abstraction layer for code hosting providers (GitHub, GitLab, Bitbucket).
// Level 2 plugins implement the CodeHostingAdapter interface.

import type { FetchedThread, FetchedPrFeedback, CICheckResult, Queries, GetWindow } from '../types';

// ── Credentials ─────────────────────────────────────────────────────────────────

export interface CodeHostingCredentials {
  /** API token (GH_TOKEN, GITLAB_TOKEN, etc.) */
  token?: string;
  /** Git author name override for this project */
  authorName?: string;
  /** Git author email override for this project */
  authorEmail?: string;
}

/**
 * Per-project code hosting config stored in projects.code_hosting_config.
 * Overrides the global plugin config for a specific project.
 */
export interface CodeHostingProjectConfig {
  /** Override token for this project */
  token?: string;
  /** Override git author name */
  authorName?: string;
  /** Override git author email */
  authorEmail?: string;
  /** Override default branch */
  defaultBranch?: string;
}

/**
 * Environment variables to inject into subprocess calls
 * (git, gh, glab, claude, etc.)
 */
export interface CodeHostingEnvVars {
  [key: string]: string | undefined;
}

// ── PR Operations ───────────────────────────────────────────────────────────────

export interface CreatePROptions {
  projectPath: string;
  branchName: string;
  baseBranch: string;
  title: string;
  body: string;
  taskId: string;
  projectName: string;
}

export interface CreatePRResult {
  prNumber: number;
  prUrl: string;
  branchName: string;
}

export interface FetchFeedbackOptions {
  projectPath: string;
  prNumber: number;
  /** Only include comments from after this review cycle */
  afterReviewCycle?: number;
}

export interface PushOptions {
  projectPath: string;
  branchName: string;
  taskId: string;
  projectName: string;
}

export interface ResolveThreadsOptions {
  projectPath: string;
  threadIds: string[];
}

export interface PostRepliesOptions {
  projectPath: string;
  replies: { threadId: string; body: string }[];
}

export interface MinimizeOptions {
  projectPath: string;
  prNumber: number;
  /** Minimize comments from review cycles before this one */
  beforeReviewCycle: number;
}

export interface FetchCIStatusOptions {
  projectPath: string;
  prNumber: number;
}

export interface ClosePROptions {
  projectPath: string;
  prNumber: number;
  comment?: string;
}

export interface CleanupOldCommentsOptions {
  projectPath: string;
  prNumber: number;
  /** Number of recent review cycles to keep */
  keepCycles: number;
}

// ── Adapter Interface ───────────────────────────────────────────────────────────

/**
 * CodeHostingAdapter — the contract that each code hosting plugin must implement.
 *
 * All methods receive resolved environment variables (token, author, etc.)
 * so they can pass them to subprocess calls without global config mutation.
 */
export interface CodeHostingAdapter {
  /** Provider identifier: 'github', 'gitlab', 'bitbucket' */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** CLI command required (e.g. 'gh', 'glab') */
  readonly cli: string;

  /**
   * Build environment variables for subprocess injection.
   * Merges global plugin config with per-project overrides.
   */
  buildEnvVars(credentials: CodeHostingCredentials): CodeHostingEnvVars;

  /**
   * Create a pull/merge request.
   */
  createPR(
    options: CreatePROptions,
    env: CodeHostingEnvVars,
    q: Queries,
    getWindow: GetWindow
  ): Promise<CreatePRResult>;

  /**
   * Fetch unresolved PR feedback (comments + review threads).
   */
  fetchFeedback(
    options: FetchFeedbackOptions,
    env: CodeHostingEnvVars
  ): Promise<FetchedPrFeedback>;

  /**
   * Post reply comments to review threads.
   */
  postReplies(
    options: PostRepliesOptions,
    env: CodeHostingEnvVars
  ): Promise<void>;

  /**
   * Resolve/close review threads.
   */
  resolveThreads(
    options: ResolveThreadsOptions,
    env: CodeHostingEnvVars
  ): Promise<void>;

  /**
   * Minimize outdated review comments from previous cycles.
   */
  minimizeOldComments(
    options: MinimizeOptions,
    env: CodeHostingEnvVars
  ): Promise<void>;

  /**
   * Fetch CI/pipeline check status for a PR.
   * Returns overall status + failure logs if any checks failed.
   */
  fetchCIStatus(
    options: FetchCIStatusOptions,
    env: CodeHostingEnvVars
  ): Promise<CICheckResult>;

  /**
   * Push the current branch to remote.
   */
  push(
    options: PushOptions,
    env: CodeHostingEnvVars,
    q: Queries,
    getWindow: GetWindow
  ): Promise<void>;

  /**
   * Close/decline a pull request (e.g. when task is re-queued).
   */
  closePR(
    options: ClosePROptions,
    env: CodeHostingEnvVars
  ): Promise<void>;

  /**
   * Clean up old review comments from previous cycles.
   * Provider-specific: GitHub deletes/minimizes, Bitbucket is a no-op, etc.
   */
  cleanupOldComments(
    options: CleanupOldCommentsOptions,
    env: CodeHostingEnvVars,
    q: Queries,
    getWindow: GetWindow,
    taskId: string,
    projectName: string
  ): Promise<void>;

  /**
   * Fetch unresolved PR feedback with full logging support.
   * Used by pr-feedback.ts for the Fetch & Fix flow.
   */
  fetchFeedbackFull(
    options: FetchFeedbackOptions,
    env: CodeHostingEnvVars,
    q: Queries,
    getWindow: GetWindow,
    taskId: string,
    projectName: string
  ): Promise<FetchedPrFeedback>;

  /**
   * Post reply comments with full logging support.
   */
  postRepliesFull(
    options: PostRepliesOptions,
    env: CodeHostingEnvVars,
    q: Queries,
    getWindow: GetWindow,
    taskId: string,
    projectName: string
  ): Promise<void>;

  /**
   * Resolve/close review threads with full logging support.
   */
  resolveThreadsFull(
    options: ResolveThreadsOptions,
    env: CodeHostingEnvVars,
    q: Queries,
    getWindow: GetWindow,
    taskId: string,
    projectName: string
  ): Promise<void>;

  /**
   * Minimize outdated review comments with full logging support.
   */
  minimizeOldCommentsFull(
    options: MinimizeOptions,
    env: CodeHostingEnvVars,
    q: Queries,
    getWindow: GetWindow,
    taskId: string,
    projectName: string
  ): Promise<void>;
}
