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
} from './types';

export {
  getAdapter,
  registerAdapter,
  resolveCredentials,
  resolveEnvVars,
  getProjectAdapter,
  resolveDefaultBranch,
} from './registry';

export { GitHubAdapter } from './github';
