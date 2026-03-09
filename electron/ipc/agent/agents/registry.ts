import type Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AgentAdapter, PhaseAgentConfig } from './types';
import { AGENT_CONFIG_FOLDERS } from './types';
import { ClaudeAdapter } from './claude-adapter';
import { GenericAdapter, BUILTIN_AGENTS } from './generic-adapter';
import type { TierName } from '../../license';

// ── Agent Registry ──────────────────────────────────────────────────────────────

const registry = new Map<string, AgentAdapter>();

export function registerAgent(adapter: AgentAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getAgent(id: string): AgentAdapter | undefined {
  return registry.get(id);
}

export function getAllAgents(): AgentAdapter[] {
  return Array.from(registry.values());
}

/**
 * Check which agents are installed. Returns map of agentId → version string.
 */
export async function getInstalledAgents(): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {};
  const checks = getAllAgents().map(async (agent) => {
    const version = await agent.checkInstalled();
    results[agent.id] = version;
  });
  await Promise.all(checks);
  return results;
}

/**
 * Check if speckit (SDD Kit) commands are installed for a given agent.
 * Each agent has its own commands directory: ~/{configFolder}/commands/speckit.specify.md
 * Configured via: specify init . --ai {agent}
 */
export function checkSpeckitForAgent(agentId: string): boolean {
  const configFolder = AGENT_CONFIG_FOLDERS[agentId];
  if (!configFolder) return false;
  const home = homedir();
  const commandsDir = join(home, configFolder, 'commands');
  // Specify CLI generates .md for Claude, .toml for Gemini, etc.
  return existsSync(join(commandsDir, 'speckit.specify.md'))
    || existsSync(join(commandsDir, 'speckit.specify.toml'));
}

/**
 * Check speckit status for all registered agents.
 * Returns map of agentId → boolean (true if speckit commands are installed).
 */
export function getSpeckitStatus(): Record<string, boolean> {
  const results: Record<string, boolean> = {};
  for (const agent of getAllAgents()) {
    results[agent.id] = checkSpeckitForAgent(agent.id);
  }
  return results;
}

// ── Agent Resolution ────────────────────────────────────────────────────────────

interface ResolvedAgent {
  primary: AgentAdapter;
  fallback?: AgentAdapter;
}

function getSettingValue(db: Database.Database, key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || '';
}

function getTier(db: Database.Database): TierName {
  const tier = getSettingValue(db, 'license_plan') as TierName;
  if (tier === 'premium' || tier === 'registered') return tier;
  return 'free';
}

/**
 * Resolve which agent(s) to use for a given phase.
 *
 * Free:       global default only (one agent for ALL projects)
 * Registered: project.ai_agent → global default → 'claude'
 * Premium:    project.ai_agent_phases[phase] → project.ai_agent → global default → 'claude'
 */
export function resolveAgentForPhase(
  db: Database.Database,
  projectId: string,
  phase: number
): ResolvedAgent {
  const tier = getTier(db);
  const globalDefault = getSettingValue(db, 'default_ai_agent') || 'claude';

  // Load project data
  const project = db.prepare('SELECT ai_agent, ai_agent_phases FROM projects WHERE id = ?').get(projectId) as
    { ai_agent: string | null; ai_agent_phases: string | null } | undefined;

  const projectAgent = project?.ai_agent || null;
  let phaseConfig: Record<string, PhaseAgentConfig> = {};
  if (project?.ai_agent_phases) {
    try { phaseConfig = JSON.parse(project.ai_agent_phases); } catch { /* ignore */ }
  }

  let primaryId: string;
  let fallbackId: string | undefined;

  if (tier === 'free') {
    // Free: global only, no project override
    primaryId = globalDefault;
  } else if (tier === 'registered') {
    // Registered: project override → global default
    primaryId = projectAgent || globalDefault;
  } else {
    // Premium: phase config → project default → global default
    const phaseKey = String(phase);
    if (phaseConfig[phaseKey]) {
      primaryId = phaseConfig[phaseKey].primary;
      fallbackId = phaseConfig[phaseKey].fallback;
    } else {
      primaryId = projectAgent || globalDefault;
    }
  }

  const primary = registry.get(primaryId) || registry.get('claude')!;
  const fallback = fallbackId ? registry.get(fallbackId) : undefined;

  return { primary, fallback };
}

// ── Run Agent Phase (with failover for Premium) ─────────────────────────────────

import type { AgentRunOptions, AgentRunResult } from './types';
import { sendLog } from '../state';
import type { Queries, GetWindow } from '../types';

/**
 * Run a workflow phase using the resolved agent for the project/phase.
 * Validates the agent is installed before spawning.
 * Premium tier: if primary fails, automatically retries with fallback agent.
 */
export async function runAgentPhase(
  db: Database.Database,
  projectId: string,
  phase: number,
  options: AgentRunOptions
): Promise<AgentRunResult> {
  let { primary, fallback } = resolveAgentForPhase(db, projectId, phase);

  // Log which agent is being used
  const task = options.q.getTask.get(options.taskId) as { project_name: string } | undefined;
  const projectName = task?.project_name || '';

  // Validate primary agent is installed — if not, try fallback or any installed agent
  const primaryInstalled = await primary.checkInstalled();
  if (!primaryInstalled) {
    if (fallback) {
      const fallbackInstalled = await fallback.checkInstalled();
      if (fallbackInstalled) {
        sendLog(options.q, options.getWindow, options.taskId, projectName,
          `Agent "${primary.name}" is not installed. Using fallback: ${fallback.name}`, 'info');
        primary = fallback;
        fallback = undefined;
      }
    }

    // Still not installed? Try to find ANY installed agent
    if (!primaryInstalled && !(await primary.checkInstalled())) {
      const allAgents = getAllAgents();
      for (const agent of allAgents) {
        const ver = await agent.checkInstalled();
        if (ver) {
          sendLog(options.q, options.getWindow, options.taskId, projectName,
            `Agent "${primary.name}" is not installed. Falling back to ${agent.name} (${ver})`, 'info');
          primary = agent;
          fallback = undefined;
          break;
        }
      }

      // If still no agent found, give a clear error
      const finalCheck = await primary.checkInstalled();
      if (!finalCheck) {
        throw new Error(
          `No AI agent is installed on this machine. Install at least one agent CLI (e.g. claude, gemini, codex) and try again.`
        );
      }
    }
  }

  sendLog(options.q, options.getWindow, options.taskId, projectName,
    `Agent: ${primary.name}${fallback ? ` (fallback: ${fallback.name})` : ''}`, 'info');

  // Apply adapter-specific prompt transformation if available
  const transformedOptions = primary.transformPrompt
    ? { ...options, prompt: primary.transformPrompt(options.prompt, phase) }
    : options;

  try {
    return await primary.runPhase(transformedOptions);
  } catch (err) {
    // Don't failover on abort
    if ((err as Error).name === 'AbortError') throw err;

    if (fallback) {
      // Verify fallback is installed before attempting
      const fallbackInstalled = await fallback.checkInstalled();
      if (!fallbackInstalled) {
        sendLog(options.q, options.getWindow, options.taskId, projectName,
          `Primary agent (${primary.name}) failed and fallback (${fallback.name}) is not installed.`, 'error');
        throw err;
      }
      sendLog(options.q, options.getWindow, options.taskId, projectName,
        `Primary agent (${primary.name}) failed: ${(err as Error).message}. Switching to fallback: ${fallback.name}`, 'info');
      const fallbackOptions = fallback.transformPrompt
        ? { ...options, prompt: fallback.transformPrompt(options.prompt, phase) }
        : options;
      return await fallback.runPhase(fallbackOptions);
    }
    throw err;
  }
}

// ── Auto-register all built-in agents ───────────────────────────────────────────

export function initRegistry(): void {
  // Claude gets its own specialized adapter
  registerAgent(new ClaudeAdapter());

  // All other agents use the config-driven generic adapter
  for (const def of BUILTIN_AGENTS) {
    registerAgent(new GenericAdapter(def));
  }
}
