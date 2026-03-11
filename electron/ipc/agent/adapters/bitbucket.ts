// ── Bitbucket Adapter ──────────────────────────────────────────────────────────
//
// Implements CodeHostingAdapter for Bitbucket using `bkt` CLI.

import type {
  CodeHostingAdapter,
  CodeHostingCredentials,
  CodeHostingEnvVars,
  CreatePROptions,
  CreatePRResult,
  FetchFeedbackOptions,
  FetchCIStatusOptions,
  PostRepliesOptions,
  ResolveThreadsOptions,
  MinimizeOptions,
  PushOptions,
  ClosePROptions,
  CleanupOldCommentsOptions,
} from './types';
import type { Queries, GetWindow, FetchedPrFeedback, CICheckResult } from '../types';
import { execFileAsync } from '../claude-cli';
import {
  fetchUnresolvedPrFeedback,
  postThreadReplies,
  resolveReviewThreads,
  minimizeOldReviews,
} from '../bitbucket-api';
import { sendLog } from '../state';

export class BitbucketAdapter implements CodeHostingAdapter {
  readonly id = 'bitbucket';
  readonly name = 'Bitbucket';
  readonly cli = 'bkt';

  buildEnvVars(credentials: CodeHostingCredentials): CodeHostingEnvVars {
    const env: CodeHostingEnvVars = {};

    // bkt manages its own authentication — no token env var needed
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

    sendLog(q, getWindow, taskId, projectName, `Bitbucket: creating PR from ${branchName} → ${baseBranch}`, 'info');

    // Push branch first
    await execFileAsync('git', ['push', '-u', 'origin', branchName], projectPath, 60000, false, env);
    sendLog(q, getWindow, taskId, projectName, `Bitbucket: pushed branch ${branchName}`, 'ok');

    // Create PR via bkt CLI
    const prOutput = await execFileAsync(
      'bkt',
      ['pr', 'create', '--title', title, '--body', body, '--source', branchName, '--target', baseBranch, '--json'],
      projectPath,
      30000,
      false,
      env
    );

    // Parse PR output — bkt --json returns JSON with id and links
    let prNumber = 0;
    let prUrl = '';
    try {
      const prData = JSON.parse(prOutput.trim()) as { id?: number; links?: { html?: { href?: string } }; url?: string };
      prNumber = prData.id || 0;
      prUrl = prData.links?.html?.href || prData.url || '';
    } catch {
      // Fallback: try to parse PR number from text output
      const numMatch = prOutput.match(/(?:PR|pull request)\s*#?(\d+)/i);
      prNumber = numMatch ? parseInt(numMatch[1], 10) : 0;
      const urlMatch = prOutput.match(/https?:\/\/\S+/);
      prUrl = urlMatch ? urlMatch[0] : '';
    }

    sendLog(q, getWindow, taskId, projectName, `Bitbucket: PR #${prNumber} created — ${prUrl}`, 'ok');

    return { prNumber, prUrl, branchName };
  }

  async fetchFeedback(
    options: FetchFeedbackOptions,
    env: CodeHostingEnvVars
  ): Promise<FetchedPrFeedback> {
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

  async fetchCIStatus(
    options: FetchCIStatusOptions,
    env: CodeHostingEnvVars
  ): Promise<CICheckResult> {
    const { projectPath, prNumber } = options;

    try {
      const checksJson = await execFileAsync(
        'bkt',
        ['pr', 'checks', String(prNumber), '--json'],
        projectPath,
        30000,
        false,
        env
      );

      const checks = JSON.parse(checksJson.trim()) as {
        name: string;
        state: string;
        url?: string;
      }[];

      if (checks.length === 0) {
        return { status: 'unknown', summary: 'No CI checks configured' };
      }

      // Bitbucket states: SUCCESSFUL, FAILED, INPROGRESS, STOPPED
      const pending = checks.filter((c) => c.state === 'INPROGRESS');
      const failed = checks.filter((c) => c.state === 'FAILED' || c.state === 'STOPPED');
      const passed = checks.filter((c) => c.state === 'SUCCESSFUL');

      if (pending.length > 0) {
        return {
          status: 'pending',
          summary: `${pending.length}/${checks.length} checks still running`,
          pendingChecks: pending.map((c) => c.name),
        };
      }

      if (failed.length > 0) {
        // Bitbucket doesn't expose failure logs via CLI — only URLs
        const failureUrls = failed
          .filter((c) => c.url)
          .map((c) => `${c.name}: ${c.url}`)
          .join('\n');

        return {
          status: 'fail',
          summary: `${failed.length}/${checks.length} checks failed: ${failed.map((c) => c.name).join(', ')}`,
          failureLogs: failureUrls || undefined,
        };
      }

      return {
        status: 'pass',
        summary: `${passed.length}/${checks.length} checks passed`,
      };
    } catch {
      return { status: 'unknown', summary: 'Could not fetch CI status' };
    }
  }

  async push(
    options: PushOptions,
    env: CodeHostingEnvVars,
    q: Queries,
    getWindow: GetWindow
  ): Promise<void> {
    const { projectPath, branchName, taskId, projectName } = options;

    await execFileAsync('git', ['push', 'origin', branchName], projectPath, 60000, false, env);
    sendLog(q, getWindow, taskId, projectName, `Bitbucket: pushed to ${branchName}`, 'ok');
  }

  async closePR(
    options: ClosePROptions,
    env: CodeHostingEnvVars
  ): Promise<void> {
    const args = ['pr', 'decline', String(options.prNumber)];
    await execFileAsync('bkt', args, options.projectPath, 15000, false, env);
  }

  async cleanupOldComments(
    _options: CleanupOldCommentsOptions,
    _env: CodeHostingEnvVars,
    q: Queries,
    getWindow: GetWindow,
    taskId: string,
    projectName: string
  ): Promise<void> {
    // Bitbucket has no comment deletion/minimization API — no-op
    sendLog(q, getWindow, taskId, projectName, 'Bitbucket does not support comment cleanup — skipping.', 'info');
  }

  async fetchFeedbackFull(
    options: FetchFeedbackOptions,
    env: CodeHostingEnvVars,
    q: Queries,
    getWindow: GetWindow,
    taskId: string,
    projectName: string
  ): Promise<FetchedPrFeedback> {
    return fetchUnresolvedPrFeedback(
      options.projectPath,
      options.prNumber,
      taskId,
      projectName,
      q,
      getWindow,
      env
    );
  }

  async postRepliesFull(
    options: PostRepliesOptions,
    env: CodeHostingEnvVars,
    q: Queries,
    getWindow: GetWindow,
    taskId: string,
    projectName: string
  ): Promise<void> {
    await postThreadReplies(
      options.projectPath,
      options.replies,
      taskId,
      projectName,
      q,
      getWindow,
      env
    );
  }

  async resolveThreadsFull(
    options: ResolveThreadsOptions,
    env: CodeHostingEnvVars,
    q: Queries,
    getWindow: GetWindow,
    taskId: string,
    projectName: string
  ): Promise<void> {
    await resolveReviewThreads(
      options.projectPath,
      options.threadIds,
      taskId,
      projectName,
      q,
      getWindow,
      env
    );
  }

  async minimizeOldCommentsFull(
    options: MinimizeOptions,
    env: CodeHostingEnvVars,
    q: Queries,
    getWindow: GetWindow,
    taskId: string,
    projectName: string
  ): Promise<void> {
    await minimizeOldReviews(
      options.projectPath,
      options.prNumber,
      taskId,
      projectName,
      q,
      getWindow,
      env
    );
  }
}
