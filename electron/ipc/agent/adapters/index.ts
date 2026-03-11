// ── Adapters — Public API ───────────────────────────────────────────────────────

export type {
  CodeHostingAdapter,
  CodeHostingCredentials,
  CodeHostingEnvVars,
  CodeHostingProjectConfig,
  CreatePROptions,
  CreatePRResult,
  FetchFeedbackOptions,
  PostRepliesOptions,
  ResolveThreadsOptions,
  MinimizeOptions,
  PushOptions,
  ClosePROptions,
  CleanupOldCommentsOptions,
} from './types';

export {
  getAdapter,
  registerAdapterFactory,
  resolveCredentials,
  resolveEnvVars,
  getProjectAdapter,
  resolveDefaultBranch,
} from './registry';

export { GitHubAdapter } from './github';
export { BitbucketAdapter } from './bitbucket';
