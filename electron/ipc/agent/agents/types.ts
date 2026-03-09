import type { Queries, GetWindow } from '../types';

// ── Agent Adapter Interface ─────────────────────────────────────────────────────

export interface AgentRunOptions {
  projectPath: string;
  model: string;
  prompt: string;
  taskId: string;
  q: Queries;
  getWindow: GetWindow;
  controller: AbortController;
  timeoutMs: number;
  extraEnv?: Record<string, string | undefined>;
}

export interface AgentRunResult {
  output: string;
  exitCode: number;
}

export interface AgentAdapter {
  /** Unique identifier: 'claude', 'gemini', 'codex', etc. */
  readonly id: string;
  /** Display name: 'Claude Code', 'Gemini CLI', etc. */
  readonly name: string;
  /** Binary name in PATH */
  readonly binary: string;
  /** Args for version check, e.g. ['--version'] */
  readonly versionArgs: string[];

  /** Check if installed. Returns version string or null. */
  checkInstalled(): Promise<string | null>;

  /** Run a workflow phase. Handles spawn, stdin, output collection. */
  runPhase(options: AgentRunOptions): Promise<AgentRunResult>;

  /** Optional: transform prompt before sending (e.g. replace tool references). */
  transformPrompt?(prompt: string, phase: number): string;

  /** Build clean environment for subprocess. */
  cleanEnv(extraEnv?: Record<string, string | undefined>): NodeJS.ProcessEnv;
}

// ── Per-Phase Config ────────────────────────────────────────────────────────────

export interface PhaseAgentConfig {
  primary: string;
  fallback?: string;
}

// ── Generic Agent Definition (config-driven) ────────────────────────────────────

export interface GenericAgentDef {
  id: string;
  name: string;
  binary: string;
  versionArgs: string[];
  /** Build spawn args for a phase run. */
  buildRunArgs: (model: string) => string[];
  /** Whether prompt is sent via stdin (true) or as a CLI arg (false). */
  stdinPrompt: boolean;
  /** Env vars to strip before spawning. */
  envCleanKeys?: string[];
  /** Agent config folder relative to HOME (e.g. '.claude/'). Aligned with specify AGENT_CONFIG. */
  configFolder: string;
}

// ── Speckit detection per agent ──────────────────────────────────────────────────

/**
 * Map of agent ID → config folder (from specify CLI AGENT_CONFIG).
 * Used to check if speckit commands are installed for each agent.
 * Global commands live at: ~/{configFolder}/commands/speckit.*.md
 */
export const AGENT_CONFIG_FOLDERS: Record<string, string> = {
  'claude':  '.claude/',
  'gemini':  '.gemini/',
};
