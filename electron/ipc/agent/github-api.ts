import type { Queries, GetWindow, FetchedThread, FetchedPrFeedback } from './types';
import { execFileAsync, execGraphQL } from './claude-cli';
import { sendLog } from './state';
import { getDefaultBranch } from './git-ops';

// ── GitHub API — PR Feedback & Review Threads ──────────────────────────────────

export async function fetchUnresolvedPrFeedback(
  projectPath: string,
  prNumber: number,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow,
  extraEnv?: Record<string, string | undefined>
): Promise<FetchedPrFeedback> {
  let generalComments = '';
  const threads: FetchedThread[] = [];

  // 1. Fetch general PR comments (non-inline) via GraphQL to access isMinimized
  try {
    const repoJsonGc = await execFileAsync('gh', ['repo', 'view', '--json', 'owner,name'], projectPath, 30000, false, extraEnv);
    const repoInfoGc = JSON.parse(repoJsonGc.trim()) as { owner: { login: string }; name: string };
    const gcQuery = `query($owner: String!, $name: String!, $pr: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) { comments(first: 50) { nodes { body isMinimized author { login } } } reviews(first: 50) { nodes { body isMinimized state author { login } } } } } }`;
    const gcOutput = await execGraphQL(gcQuery, projectPath, 15000, { owner: repoInfoGc.owner.login, name: repoInfoGc.name, pr: prNumber }, extraEnv);
    const gcData = JSON.parse(gcOutput) as {
      data: { repository: { pullRequest: {
        comments: { nodes: { body: string; isMinimized: boolean; author: { login: string } | null }[] };
        reviews: { nodes: { body: string; isMinimized: boolean; state: string; author: { login: string } | null }[] };
      } } }
    };
    const pr = gcData.data.repository.pullRequest;
    const comments = pr.comments.nodes
      .filter((c) => !c.isMinimized && c.body.trim())
      .map((c) => `[${c.author?.login || 'unknown'}]: ${c.body}`);
    const reviews = pr.reviews.nodes
      .filter((r) => !r.isMinimized && r.body.trim())
      .map((r) => `[${r.author?.login || 'unknown'} (${r.state})]: ${r.body}`);
    const all = [...comments, ...reviews];
    if (all.length > 0) {
      generalComments = all.join('\n\n');
    }
    const skippedMinimized = pr.comments.nodes.filter((c) => c.isMinimized).length + pr.reviews.nodes.filter((r) => r.isMinimized).length;
    if (skippedMinimized > 0) {
      sendLog(q, getWindow, taskId, projectName, `Skipping ${skippedMinimized} minimized/hidden comment(s).`, 'info');
    }
  } catch (err) {
    sendLog(q, getWindow, taskId, projectName, `Warning: Could not fetch general PR comments: ${(err as Error).message}`, 'error');
  }

  // 2. Fetch review threads (inline code comments) via GraphQL — includes resolution status
  try {
    const repoOutput = await execFileAsync('gh', ['repo', 'view', '--json', 'nameWithOwner'], projectPath, 30000, false, extraEnv);
    const { nameWithOwner } = JSON.parse(repoOutput) as { nameWithOwner: string };
    const [owner, repo] = nameWithOwner.split('/');

    const graphqlQuery = `query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              isOutdated
              comments(first: 30) {
                nodes {
                  body
                  author { login }
                  path
                  line
                  diffHunk
                }
              }
            }
          }
        }
      }
    }`;

    const graphqlOutput = await execGraphQL(graphqlQuery, projectPath, 30000, { owner, repo, pr: prNumber }, extraEnv);
    const gqlData = JSON.parse(graphqlOutput) as {
      data: { repository: { pullRequest: { reviewThreads: { nodes: { id: string; isResolved: boolean; isOutdated: boolean; comments: { nodes: { body: string; author: { login: string } | null; path: string; line: number | null; diffHunk: string | null }[] } }[] } } } }
    };

    const allThreads = gqlData.data.repository.pullRequest.reviewThreads.nodes;
    const unresolved = allThreads.filter((t) => !t.isResolved);
    const resolvedCount = allThreads.length - unresolved.length;

    if (resolvedCount > 0) {
      sendLog(q, getWindow, taskId, projectName, `Skipping ${resolvedCount} already-resolved review thread(s).`, 'info');
    }

    // Auto-resolve outdated threads (from old commits) so they don't pollute future cycles
    const outdated = unresolved.filter((t) => t.isOutdated);
    const current = unresolved.filter((t) => !t.isOutdated);

    if (outdated.length > 0) {
      sendLog(q, getWindow, taskId, projectName, `Found ${outdated.length} outdated thread(s) from old commits — auto-resolving.`, 'info');
      const outdatedIds = outdated.map((t) => t.id);
      try {
        await resolveReviewThreads(projectPath, outdatedIds, taskId, projectName, q, getWindow, extraEnv);
        sendLog(q, getWindow, taskId, projectName, `Auto-resolved ${outdatedIds.length} outdated thread(s).`, 'info');
      } catch (resolveErr) {
        sendLog(q, getWindow, taskId, projectName, `Warning: Could not auto-resolve outdated threads: ${(resolveErr as Error).message}`, 'error');
      }
    }

    for (const thread of current) {
      const firstComment = thread.comments.nodes[0];
      threads.push({
        id: thread.id,
        file: firstComment?.path || 'unknown',
        line: firstComment?.line ?? null,
        diffHunk: firstComment?.diffHunk ?? null,
        comments: thread.comments.nodes.map((c) => ({
          author: c.author?.login || 'unknown',
          body: c.body,
        })),
      });
    }
  } catch (err) {
    sendLog(q, getWindow, taskId, projectName, `Warning: Could not fetch review threads via GraphQL: ${(err as Error).message}. Falling back to basic comments.`, 'error');
    // Fallback: fetch reviewComments via gh pr view (no thread IDs available)
    try {
      const fallbackOutput = await execFileAsync('gh', [
        'pr', 'view', String(prNumber),
        '--json', 'reviewComments',
      ], projectPath, 30000, false, extraEnv);
      const fallbackData = JSON.parse(fallbackOutput);
      for (const c of (fallbackData.reviewComments || []) as { body: string; author?: { login: string }; path?: string; line?: number }[]) {
        threads.push({
          id: '',  // no thread ID in fallback mode
          file: c.path || 'unknown',
          line: c.line ?? null,
          diffHunk: null,
          comments: [{ author: c.author?.login || 'unknown', body: c.body }],
        });
      }
    } catch {
      // ignore fallback failure
    }
  }

  return { generalComments, threads };
}

export async function postThreadReplies(
  projectPath: string,
  replies: { threadId: string; body: string }[],
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow,
  extraEnv?: Record<string, string | undefined>
): Promise<void> {
  let posted = 0;
  for (const reply of replies) {
    try {
      const mutation = `mutation($threadId: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $threadId, body: $body}) { comment { id } } }`;
      await execGraphQL(mutation, projectPath, 30000, { threadId: reply.threadId, body: reply.body }, extraEnv);
      posted++;
    } catch (err) {
      sendLog(q, getWindow, taskId, projectName, `Warning: Could not reply to thread ${reply.threadId}: ${(err as Error).message}`, 'error');
    }
  }
  if (posted > 0) {
    sendLog(q, getWindow, taskId, projectName, `Posted ${posted} justification reply(s) on GitHub PR.`, 'ok');
  }
}

export async function resolveReviewThreads(
  projectPath: string,
  threadIds: string[],
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow,
  extraEnv?: Record<string, string | undefined>
): Promise<void> {
  let resolved = 0;
  for (const threadId of threadIds) {
    try {
      const mutation = `mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { isResolved } } }`;
      await execGraphQL(mutation, projectPath, 30000, { threadId }, extraEnv);
      resolved++;
    } catch (err) {
      sendLog(q, getWindow, taskId, projectName, `Warning: Could not resolve thread ${threadId}: ${(err as Error).message}`, 'error');
    }
  }
  if (resolved > 0) {
    sendLog(q, getWindow, taskId, projectName, `Resolved ${resolved}/${threadIds.length} review thread(s) on GitHub.`, 'ok');
  }
}

export async function minimizeOldReviews(
  projectPath: string,
  prNumber: number,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow,
  extraEnv?: Record<string, string | undefined>
): Promise<void> {
  try {
    const repoJson = await execFileAsync('gh', ['repo', 'view', '--json', 'owner,name'], projectPath, 30000, false, extraEnv);
    const repoInfo = JSON.parse(repoJson.trim()) as { owner: { login: string }; name: string };

    // Fetch reviews + resolved thread comments
    const query = `query($owner: String!, $name: String!, $pr: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) { reviews(first: 50) { nodes { id isMinimized } } reviewThreads(first: 100) { nodes { isResolved comments(first: 30) { nodes { id isMinimized } } } } } } }`;
    const output = await execGraphQL(query, projectPath, 15000, { owner: repoInfo.owner.login, name: repoInfo.name, pr: prNumber }, extraEnv);
    const data = JSON.parse(output) as {
      data: { repository: { pullRequest: {
        reviews: { nodes: { id: string; isMinimized: boolean }[] };
        reviewThreads: { nodes: { isResolved: boolean; comments: { nodes: { id: string; isMinimized: boolean }[] } }[] };
      } } }
    };

    const idsToMinimize: string[] = [];

    // Parent review bodies
    for (const review of data.data.repository.pullRequest.reviews.nodes) {
      if (!review.isMinimized) idsToMinimize.push(review.id);
    }

    // Individual comments inside resolved threads
    for (const thread of data.data.repository.pullRequest.reviewThreads.nodes) {
      if (thread.isResolved) {
        for (const comment of thread.comments.nodes) {
          if (!comment.isMinimized) idsToMinimize.push(comment.id);
        }
      }
    }

    if (idsToMinimize.length === 0) return;

    let minimized = 0;
    for (const nodeId of idsToMinimize) {
      try {
        const mutation = `mutation($id: ID!) { minimizeComment(input: {subjectId: $id, classifier: RESOLVED}) { minimizedComment { isMinimized } } }`;
        await execGraphQL(mutation, projectPath, 30000, { id: nodeId }, extraEnv);
        minimized++;
      } catch {
        // Some node types may not support minimization — skip
      }
    }

    if (minimized > 0) {
      sendLog(q, getWindow, taskId, projectName, `Minimized ${minimized} old review comment(s) as resolved.`, 'ok');
    }
  } catch (err) {
    sendLog(q, getWindow, taskId, projectName, `Warning: Could not clean up old reviews: ${(err as Error).message}`, 'info');
  }
}

export async function cleanupOldPRComments(
  projectPath: string,
  prNumber: number,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow,
  keepCycles: number = 2,
  extraEnv?: Record<string, string | undefined>
): Promise<void> {
  try {
    const defaultBranch = await getDefaultBranch(projectPath);

    // Get commit OIDs on the branch (newest first)
    const commitsOutput = await execFileAsync('git', ['log', '--format=%H', `${defaultBranch}..HEAD`], projectPath, 10000, false, extraEnv);
    const commitOids = commitsOutput.trim().split('\n').filter(Boolean);

    // Not enough commits to safely delete — need rollback margin
    if (commitOids.length <= keepCycles) return;

    // Keep reviews from the last N commits
    const keepOids = new Set(commitOids.slice(0, keepCycles));

    const repoJson = await execFileAsync('gh', ['repo', 'view', '--json', 'owner,name'], projectPath, 30000, false, extraEnv);
    const repoInfo = JSON.parse(repoJson.trim()) as { owner: { login: string }; name: string };

    // Fetch reviews with commit OID + comment databaseId for REST deletion
    const query = `query($owner: String!, $name: String!, $pr: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) { reviews(first: 100) { nodes { id commit { oid } isMinimized comments(first: 50) { nodes { id databaseId isMinimized } } } } reviewThreads(first: 100) { nodes { id isResolved comments(first: 1) { nodes { id } } } } } } }`;
    const output = await execGraphQL(query, projectPath, 15000, { owner: repoInfo.owner.login, name: repoInfo.name, pr: prNumber }, extraEnv);
    const data = JSON.parse(output) as {
      data: { repository: { pullRequest: {
        reviews: { nodes: { id: string; commit: { oid: string } | null; isMinimized: boolean; comments: { nodes: { id: string; databaseId: number; isMinimized: boolean }[] } }[] };
        reviewThreads: { nodes: { id: string; isResolved: boolean; comments: { nodes: { id: string }[] } }[] };
      } } }
    };

    let deleted = 0;
    let minimized = 0;
    const repoSlug = `${repoInfo.owner.login}/${repoInfo.name}`;

    for (const review of data.data.repository.pullRequest.reviews.nodes) {
      const commitOid = review.commit?.oid;
      if (!commitOid || keepOids.has(commitOid)) continue;

      // Old review — delete individual comments via REST, fallback to minimize
      for (const comment of review.comments.nodes) {
        if (comment.isMinimized) continue;
        try {
          await execFileAsync('gh', ['api', '-X', 'DELETE', `repos/${repoSlug}/pulls/comments/${comment.databaseId}`], projectPath, 5000, false, extraEnv);
          deleted++;
        } catch {
          try {
            const mut = `mutation($id: ID!) { minimizeComment(input: {subjectId: $id, classifier: RESOLVED}) { minimizedComment { isMinimized } } }`;
            await execGraphQL(mut, projectPath, 30000, { id: comment.id }, extraEnv);
            minimized++;
          } catch { /* skip */ }
        }
      }

      // Minimize the review body (can't delete submitted reviews)
      if (!review.isMinimized) {
        try {
          const mut = `mutation($id: ID!) { minimizeComment(input: {subjectId: $id, classifier: RESOLVED}) { minimizedComment { isMinimized } } }`;
          await execGraphQL(mut, projectPath, 30000, { id: review.id }, extraEnv);
          minimized++;
        } catch { /* skip */ }
      }
    }

    if (deleted + minimized > 0) {
      sendLog(q, getWindow, taskId, projectName,
        `Cleaned up old PR reviews: ${deleted} comment(s) deleted, ${minimized} minimized. Kept last ${keepCycles} cycle(s).`,
        'ok'
      );
    }
  } catch (err) {
    sendLog(q, getWindow, taskId, projectName, `Warning: Could not clean up old PR comments: ${(err as Error).message}`, 'info');
  }
}
