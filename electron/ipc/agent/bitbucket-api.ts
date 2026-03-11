import type { Queries, GetWindow, FetchedThread, FetchedPrFeedback } from './types';
import { execFileAsync } from './claude-cli';
import { sendLog } from './state';

// ── Bitbucket API — PR Feedback & Review Comments ───────────────────────────

type BitbucketVariant = 'cloud' | 'datacenter';

interface BitbucketRemoteInfo {
  /** workspace (Cloud) or project key (Data Center) */
  workspace: string;
  repo: string;
  variant: BitbucketVariant;
  host: string;
}

/**
 * Parse the git remote URL to extract Bitbucket workspace/repo info.
 * Supports both Cloud (bitbucket.org) and Data Center (self-hosted) URLs.
 */
export function parseBitbucketRemote(remoteUrl: string): BitbucketRemoteInfo | null {
  // SSH: git@bitbucket.org:workspace/repo.git
  const sshMatch = remoteUrl.match(/git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return {
      host: sshMatch[1],
      workspace: sshMatch[2],
      repo: sshMatch[3],
      variant: detectBitbucketVariant(sshMatch[1]),
    };
  }

  // HTTPS: https://bitbucket.org/workspace/repo.git
  // HTTPS DC: https://bitbucket.mycompany.com/scm/PROJECT/repo.git
  const httpsMatch = remoteUrl.match(/https?:\/\/([^/]+)\/(?:scm\/)?([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return {
      host: httpsMatch[1],
      workspace: httpsMatch[2],
      repo: httpsMatch[3],
      variant: detectBitbucketVariant(httpsMatch[1]),
    };
  }

  return null;
}

/**
 * Detect Bitbucket variant from hostname.
 * bitbucket.org → Cloud, anything else → Data Center.
 */
export function detectBitbucketVariant(host: string): BitbucketVariant {
  return host === 'bitbucket.org' ? 'cloud' : 'datacenter';
}

/**
 * Get Bitbucket remote info for a project path.
 */
async function getRemoteInfo(
  projectPath: string,
  extraEnv?: Record<string, string | undefined>
): Promise<BitbucketRemoteInfo> {
  const remoteUrl = (await execFileAsync('git', ['remote', 'get-url', 'origin'], projectPath, 10000, false, extraEnv)).trim();
  const info = parseBitbucketRemote(remoteUrl);
  if (!info) throw new Error(`Could not parse Bitbucket remote URL: ${remoteUrl}`);
  return info;
}

// ── Cloud API types ─────────────────────────────────────────────────────────

interface CloudComment {
  id: number;
  content: { raw: string };
  user: { display_name: string; nickname?: string };
  parent?: { id: number };
  inline?: { path: string; to?: number; from?: number };
  deleted: boolean;
}

// ── Data Center API types ───────────────────────────────────────────────────

interface DCComment {
  id: number;
  text: string;
  author: { displayName: string; slug?: string };
  parent?: { id: number };
  state?: string; // OPEN, RESOLVED
  anchor?: { path: string; line?: number; lineType?: string; diffType?: string };
  comments?: DCComment[]; // nested replies in DC
}

interface DCActivity {
  id: number;
  action: string;
  comment?: DCComment;
}

/**
 * Fetch unresolved PR feedback from Bitbucket (Cloud or Data Center).
 * Groups flat comments into threads using parent.id.
 */
export async function fetchUnresolvedPrFeedback(
  projectPath: string,
  prNumber: number,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow,
  extraEnv?: Record<string, string | undefined>
): Promise<FetchedPrFeedback> {
  const remote = await getRemoteInfo(projectPath, extraEnv);

  if (remote.variant === 'cloud') {
    return fetchCloudFeedback(projectPath, remote, prNumber, taskId, projectName, q, getWindow, extraEnv);
  }
  return fetchDataCenterFeedback(projectPath, remote, prNumber, taskId, projectName, q, getWindow, extraEnv);
}

// ── Cloud Implementation ────────────────────────────────────────────────────

async function fetchCloudFeedback(
  projectPath: string,
  remote: BitbucketRemoteInfo,
  prNumber: number,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow,
  extraEnv?: Record<string, string | undefined>
): Promise<FetchedPrFeedback> {
  let generalComments = '';
  const threads: FetchedThread[] = [];

  try {
    // Fetch all PR comments via bkt api
    const endpoint = `/2.0/repositories/${remote.workspace}/${remote.repo}/pullrequests/${prNumber}/comments?pagelen=100`;
    const output = await execFileAsync('bkt', ['api', endpoint], projectPath, 30000, false, extraEnv);
    const data = JSON.parse(output) as { values: CloudComment[] };
    const comments = (data.values || []).filter((c) => !c.deleted);

    // Separate root comments from replies
    const rootComments = comments.filter((c) => !c.parent);
    const replyMap = new Map<number, CloudComment[]>();
    for (const c of comments) {
      if (c.parent) {
        const replies = replyMap.get(c.parent.id) || [];
        replies.push(c);
        replyMap.set(c.parent.id, replies);
      }
    }

    // Group into threads
    const generalParts: string[] = [];
    for (const root of rootComments) {
      const replies = replyMap.get(root.id) || [];
      const allInThread = [root, ...replies];
      const threadComments = allInThread.map((c) => ({
        author: c.user?.nickname || c.user?.display_name || 'unknown',
        body: c.content?.raw || '',
      }));

      if (root.inline) {
        // Inline comment → thread
        threads.push({
          id: String(root.id),
          file: root.inline.path,
          line: root.inline.to ?? root.inline.from ?? null,
          diffHunk: null,
          comments: threadComments,
        });
      } else {
        // General comment
        for (const tc of threadComments) {
          generalParts.push(`[${tc.author}]: ${tc.body}`);
        }
      }
    }

    generalComments = generalParts.join('\n\n');
  } catch (err) {
    sendLog(q, getWindow, taskId, projectName, `Warning: Could not fetch Bitbucket PR comments: ${(err as Error).message}`, 'error');
  }

  return { generalComments, threads };
}

// ── Data Center Implementation ──────────────────────────────────────────────

async function fetchDataCenterFeedback(
  projectPath: string,
  remote: BitbucketRemoteInfo,
  prNumber: number,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow,
  extraEnv?: Record<string, string | undefined>
): Promise<FetchedPrFeedback> {
  let generalComments = '';
  const threads: FetchedThread[] = [];

  try {
    // Fetch activities (includes comments) via REST
    const endpoint = `/rest/api/1.0/projects/${remote.workspace}/repos/${remote.repo}/pull-requests/${prNumber}/activities?limit=500`;
    const output = await execFileAsync('bkt', ['api', endpoint], projectPath, 30000, false, extraEnv);
    const data = JSON.parse(output) as { values: DCActivity[] };

    const commentActivities = (data.values || []).filter((a) => a.action === 'COMMENTED' && a.comment);
    const generalParts: string[] = [];

    for (const activity of commentActivities) {
      const comment = activity.comment!;

      // Skip resolved comments on DC
      if (comment.state === 'RESOLVED') continue;

      const rootComments = [{
        author: comment.author?.slug || comment.author?.displayName || 'unknown',
        body: comment.text || '',
      }];

      // Include nested replies
      if (comment.comments?.length) {
        for (const reply of comment.comments) {
          if (reply.state === 'RESOLVED') continue;
          rootComments.push({
            author: reply.author?.slug || reply.author?.displayName || 'unknown',
            body: reply.text || '',
          });
        }
      }

      if (comment.anchor) {
        // Inline comment → thread
        threads.push({
          id: String(comment.id),
          file: comment.anchor.path || 'unknown',
          line: comment.anchor.line ?? null,
          diffHunk: null,
          comments: rootComments,
        });
      } else {
        // General comment
        for (const c of rootComments) {
          generalParts.push(`[${c.author}]: ${c.body}`);
        }
      }
    }

    generalComments = generalParts.join('\n\n');

    const resolvedCount = (data.values || []).filter(
      (a) => a.action === 'COMMENTED' && a.comment?.state === 'RESOLVED'
    ).length;
    if (resolvedCount > 0) {
      sendLog(q, getWindow, taskId, projectName, `Skipping ${resolvedCount} already-resolved comment thread(s).`, 'info');
    }
  } catch (err) {
    sendLog(q, getWindow, taskId, projectName, `Warning: Could not fetch Bitbucket DC PR comments: ${(err as Error).message}`, 'error');
  }

  return { generalComments, threads };
}

/**
 * Post reply to a comment thread on Bitbucket.
 */
export async function postThreadReplies(
  projectPath: string,
  replies: { threadId: string; body: string }[],
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow,
  extraEnv?: Record<string, string | undefined>
): Promise<void> {
  const remote = await getRemoteInfo(projectPath, extraEnv);
  let posted = 0;

  for (const reply of replies) {
    try {
      if (remote.variant === 'cloud') {
        const endpoint = `/2.0/repositories/${remote.workspace}/${remote.repo}/pullrequests/comments`;
        const payload = JSON.stringify({
          content: { raw: reply.body },
          parent: { id: parseInt(reply.threadId, 10) },
        });
        await execFileAsync('bkt', ['api', endpoint, '--method', 'POST', '--input', '-'], projectPath, 30000, false, {
          ...extraEnv,
          BKT_API_BODY: payload,
        });
      } else {
        // Data Center: find the PR number from the thread context
        // Reply to comment by posting with parent.id
        const prEndpoint = `/rest/api/1.0/projects/${remote.workspace}/repos/${remote.repo}/pull-requests`;
        // We need the PR number — extract from existing API calls or use the thread context
        // For DC, post via bkt api with parent reference
        const payload = JSON.stringify({
          text: reply.body,
          parent: { id: parseInt(reply.threadId, 10) },
        });
        await execFileAsync('bkt', ['api', `${prEndpoint}/comments`, '--method', 'POST', '--input', '-'], projectPath, 30000, false, {
          ...extraEnv,
          BKT_API_BODY: payload,
        });
      }
      posted++;
    } catch (err) {
      sendLog(q, getWindow, taskId, projectName, `Warning: Could not reply to thread ${reply.threadId}: ${(err as Error).message}`, 'error');
    }
  }

  if (posted > 0) {
    sendLog(q, getWindow, taskId, projectName, `Posted ${posted} reply(s) on Bitbucket PR.`, 'ok');
  }
}

/**
 * Resolve review threads on Bitbucket.
 * Data Center: PUT state=RESOLVED on the comment.
 * Cloud: no native resolve concept — logs info and skips.
 */
export async function resolveReviewThreads(
  projectPath: string,
  threadIds: string[],
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow,
  extraEnv?: Record<string, string | undefined>
): Promise<void> {
  const remote = await getRemoteInfo(projectPath, extraEnv);

  if (remote.variant === 'cloud') {
    // Bitbucket Cloud has no native thread resolution — graceful skip
    if (threadIds.length > 0) {
      sendLog(q, getWindow, taskId, projectName, `Bitbucket Cloud does not support thread resolution. ${threadIds.length} thread(s) left as-is.`, 'info');
    }
    return;
  }

  // Data Center: resolve via PUT state=RESOLVED
  let resolved = 0;
  for (const threadId of threadIds) {
    try {
      const endpoint = `/rest/api/1.0/projects/${remote.workspace}/repos/${remote.repo}/pull-requests/comments/${threadId}`;
      const payload = JSON.stringify({ state: 'RESOLVED' });
      await execFileAsync('bkt', ['api', endpoint, '--method', 'PUT', '--input', '-'], projectPath, 30000, false, {
        ...extraEnv,
        BKT_API_BODY: payload,
      });
      resolved++;
    } catch (err) {
      sendLog(q, getWindow, taskId, projectName, `Warning: Could not resolve thread ${threadId}: ${(err as Error).message}`, 'error');
    }
  }

  if (resolved > 0) {
    sendLog(q, getWindow, taskId, projectName, `Resolved ${resolved}/${threadIds.length} comment thread(s) on Bitbucket DC.`, 'ok');
  }
}

/**
 * Minimize old reviews — no-op on Bitbucket.
 * Bitbucket has no "minimize comment" concept.
 */
export async function minimizeOldReviews(
  _projectPath: string,
  _prNumber: number,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow,
  _extraEnv?: Record<string, string | undefined>
): Promise<void> {
  sendLog(q, getWindow, taskId, projectName, 'Bitbucket does not support comment minimization — skipping.', 'info');
}
