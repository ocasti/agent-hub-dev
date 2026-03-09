import { spawn, type ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import type { TaskRow } from '../types';
import { sendLog } from '../state';
import { execFileAsync } from '../claude-cli';
import type { AgentAdapter, AgentRunOptions, AgentRunResult, GenericAgentDef } from './types';

/**
 * Config-driven adapter for any CLI agent.
 * Avoids creating separate adapter classes for each agent.
 */
export class GenericAdapter implements AgentAdapter {
  readonly id: string;
  readonly name: string;
  readonly binary: string;
  readonly versionArgs: string[];
  private readonly def: GenericAgentDef;

  constructor(def: GenericAgentDef) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.binary = def.binary;
    this.versionArgs = def.versionArgs;
  }

  async checkInstalled(): Promise<string | null> {
    try {
      const output = await execFileAsync(this.binary, this.versionArgs, undefined, 10000);
      return output.trim().split('\n')[0] || null;
    } catch {
      return null;
    }
  }

  cleanEnv(extraEnv?: Record<string, string | undefined>): NodeJS.ProcessEnv {
    const env = { ...process.env };
    // Strip agent-specific env vars
    for (const key of this.def.envCleanKeys || []) {
      delete env[key];
    }
    if (extraEnv) {
      for (const [key, value] of Object.entries(extraEnv)) {
        if (value !== undefined) env[key] = value;
      }
    }
    return env;
  }

  runPhase(options: AgentRunOptions): Promise<AgentRunResult> {
    const { projectPath, model, prompt, taskId, q, getWindow, controller, timeoutMs, extraEnv } = options;

    return new Promise((resolve, reject) => {
      if (controller.signal.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        return reject(err);
      }

      const runArgs = this.def.buildRunArgs(model);
      const runId = uuidv4();
      if (taskId) q.insertAgentRun.run(runId, taskId, 'phase');

      const task = taskId ? q.getTask.get(taskId) as TaskRow | undefined : undefined;
      const projectName = task?.project_name || '';

      sendLog(q, getWindow, taskId, projectName,
        `Spawning: ${this.binary} ${runArgs.join(' ')} (stdin prompt, ${prompt.length} chars, timeout ${Math.round(timeoutMs / 60000)}min)`,
        'info');

      const child: ChildProcess = spawn(this.binary, runArgs, {
        cwd: projectPath,
        env: this.cleanEnv(extraEnv),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (this.def.stdinPrompt) {
        child.stdin?.write(prompt);
        child.stdin?.end();
      }

      let output = '';
      let errorOutput = '';
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        sendLog(q, getWindow, taskId, projectName,
          `Phase timed out after ${Math.round(timeoutMs / 60000)} minutes. Killing process.`, 'error');
        child.kill('SIGTERM');
      }, timeoutMs);

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        const lines = text.split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
          sendLog(q, getWindow, taskId, projectName, line, 'step');
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        errorOutput += text;
        const lines = text.split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
          sendLog(q, getWindow, taskId, projectName, line, 'error');
        }
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timeout);
        const result = code === 0 && !timedOut ? 'ok' : 'error';
        if (taskId) q.finishAgentRun.run(result, output, timedOut ? errorOutput + '\n[TIMED_OUT]' : errorOutput, runId);
        if (timedOut) {
          sendLog(q, getWindow, taskId, projectName, `Agent phase timed out`, 'error');
        } else {
          sendLog(q, getWindow, taskId, projectName,
            `Agent phase exited with code ${code}`, code === 0 ? 'ok' : 'error');
        }
        resolve({ output, exitCode: timedOut ? 1 : (code ?? 1) });
      });

      child.on('error', (err: Error) => {
        clearTimeout(timeout);
        if (taskId) q.finishAgentRun.run('error', output, err.message, runId);
        sendLog(q, getWindow, taskId, projectName, `Spawn error: ${err.message}`, 'error');
        reject(err);
      });

      const onAbort = () => {
        clearTimeout(timeout);
        child.kill('SIGTERM');
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });

      child.on('close', () => {
        controller.signal.removeEventListener('abort', onAbort);
      });
    });
  }
}

// ── Built-in Agent Definitions ──────────────────────────────────────────────────

// Only agents that have been TESTED and VERIFIED to work with Agent Hub.
// Claude Code has its own specialized adapter (ClaudeAdapter).
// Other agents can be added here once verified end-to-end.
//
// To add a new agent:
//   1. Verify headless/non-interactive mode works (stdin prompt → stdout output)
//   2. Verify tool execution (file read/write, bash) works in headless mode
//   3. Verify speckit commands format (e.g. .md vs .toml)
//   4. Test a full SDD cycle (spec review → plan → implement → quality gate)
//   5. Add the definition below and the config folder to AGENT_CONFIG_FOLDERS

export const BUILTIN_AGENTS: GenericAgentDef[] = [
  {
    id: 'gemini',
    name: 'Gemini CLI',
    binary: 'gemini',
    versionArgs: ['--version'],
    buildRunArgs: () => ['-p', '', '-y'],
    stdinPrompt: true,
    envCleanKeys: [],
    configFolder: '.gemini/',
  },
];
