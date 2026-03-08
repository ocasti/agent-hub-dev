// ── GitHub Adapter ──────────────────────────────────────────────────────────────
//
// Implements CodeHostingAdapter for GitHub using `gh` CLI.

import type {
  CodeHostingAdapter,
  CodeHostingCredentials,
  CodeHostingEnvVars,
  CreatePROptions,
  CreatePRResult,
  FetchFeedbackOptions,
  PostRepliesOptions,
  ResolveThreadsOptions,
  MinimizeOptions,
  PushOptions,
} from './types';
import type { Queries, GetWindow, FetchedPrFeedback } from '../types';
import { execFileAsync } from '../claude-cli';
import {
  fetchUnresolvedPrFeedback,
  postThreadReplies,
  resolveReviewThreads,
  minimizeOldReviews,
} from '../github-api';
import { sendLog } from '../state';
import { getDefaultBranch } from '../git-ops';

export class GitHubAdapter implements CodeHostingAdapter {
  readonly id = 'github';
  readonly name = 'GitHub';
  readonly cli = 'gh';

  buildEnvVars(credentials: CodeHostingCredentials): CodeHostingEnvVars {
    const env: CodeHostingEnvVars = {};

    if (credentials.token) {
      env.GH_TOKEN = credentials.token;
    }
    if (credentials.authorName) {
      env.GIT_AUTHOR_NAME = credentials.authorName;
      env.GIT_COMMITTER_NAME = credentials.authorName;
    }
    if (credentials.authorEmail) {
      env.GIT_AUTHOR_EMAIL = credentials.authorEmail;
      env.GIT_COMMITTER_EMAIL = credentials.authorEmail;
    }

    return env;
  }

  async createPR(
    options: CreatePROptions,
    env: CodeHostingEnvVars,
    q: Queries,
    getWindow: GetWindow
  ): Promise<CreatePRResult> {
    const { projectPath, branchName, baseBranch, title, body, taskId, projectName } = options;

    sendLog(q, getWindow, taskId, projectName, `GitHub: creating PR from ${branchName} → ${baseBranch}`, 'info');

    // Push branch first
    await execFileAsync('git', ['push', '-u', 'origin', branchName], projectPath, 60000, false, env);
    sendLog(q, getWindow, taskId, projectName, `GitHub: pushed branch ${branchName}`, 'ok');

    // Create PR via gh CLI
    const prOutput = await execFileAsync(
      'gh',
      ['pr', 'create', '--title', title, '--body', body, '--base', baseBranch, '--head', branchName],
      projectPath,
      30000,
      false,
      env
    );

    // Parse PR URL to extract number
    const prUrl = prOutput.trim();
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;

    sendLog(q, getWindow, taskId, projectName, `GitHub: PR #${prNumber} created — ${prUrl}`, 'ok');

    return { prNumber, prUrl, branchName };
  }

  async fetchFeedback(
    options: FetchFeedbackOptions,
    env: CodeHostingEnvVars
  ): Promise<FetchedPrFeedback> {
    // Delegate to existing function with extraEnv
    // Note: taskId/projectName/q/getWindow are not available here — these are used
    // only for logging. The caller (pr-feedback.ts) handles logging separately.
    // For now, use a minimal stub — the full integration happens in Batch 4 when
    // pr-feedback.ts is refactored to use the adapter.
    return fetchUnresolvedPrFeedback(
      options.projectPath,
      options.prNumber,
      '', // taskId — caller handles logging
      '', // projectName
      null as unknown as Queries,
      () => null,
      env
    );
  }

  async postReplies(
    options: PostRepliesOptions,
    env: CodeHostingEnvVars
  ): Promise<void> {
    await postThreadReplies(
      options.projectPath,
      options.replies,
      '', '',
      null as unknown as Queries,
      () => null,
      env
    );
  }

  async resolveThreads(
    options: ResolveThreadsOptions,
    env: CodeHostingEnvVars
  ): Promise<void> {
    await resolveReviewThreads(
      options.projectPath,
      options.threadIds,
      '', '',
      null as unknown as Queries,
      () => null,
      env
    );
  }

  async minimizeOldComments(
    options: MinimizeOptions,
    env: CodeHostingEnvVars
  ): Promise<void> {
    await minimizeOldReviews(
      options.projectPath,
      options.prNumber,
      '', '',
      null as unknown as Queries,
      () => null,
      env
    );
  }

  async push(
    options: PushOptions,
    env: CodeHostingEnvVars,
    q: Queries,
    getWindow: GetWindow
  ): Promise<void> {
    const { projectPath, branchName, taskId, projectName } = options;

    // Conventional commit + push
    await execFileAsync('git', ['push', 'origin', branchName], projectPath, 60000, false, env);
    sendLog(q, getWindow, taskId, projectName, `GitHub: pushed to ${branchName}`, 'ok');
  }
}
