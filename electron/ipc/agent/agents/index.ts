// ── Agent Adapter System — Re-exports ───────────────────────────────────────────

export type {
  AgentAdapter,
  AgentRunOptions,
  AgentRunResult,
  PhaseAgentConfig,
  GenericAgentDef,
} from './types';

export { ClaudeAdapter } from './claude-adapter';
export { GenericAdapter, BUILTIN_AGENTS } from './generic-adapter';

export {
  registerAgent,
  getAgent,
  getAllAgents,
  getInstalledAgents,
  checkSpeckitForAgent,
  getSpeckitStatus,
  resolveAgentForPhase,
  runAgentPhase,
  initRegistry,
} from './registry';
