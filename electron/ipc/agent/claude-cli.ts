import { spawn, type ChildProcess, execFile } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import type { TaskRow, Queries, GetWindow } from './types';
import { sendLog } from './state';

// ── Clean env (strip CLAUDECODE to avoid nested-session block) ─────────────────

export function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return env;
}

// ── execFileAsync ──────────────────────────────────────────────────────────────

export function execFileAsync(cmd: string, args: string[], cwd?: string, timeoutMs: number = 30000, useShell: boolean = false): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { shell: useShell, env: cleanEnv(), cwd, timeout: timeoutMs }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/**
 * Execute a GraphQL query via `gh api graphql` with proper variable passing.
 * Uses -f for string variables and -F for numeric variables to avoid injection.
 */
export function execGraphQL(
  query: string,
  cwd: string,
  timeoutMs: number = 30000,
  variables?: Record<string, string | number>
): Promise<string> {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      if (typeof value === 'number') {
        args.push('-F', `${key}=${value}`);
      } else {
        args.push('-f', `${key}=${value}`);
      }
    }
  }
  return new Promise((resolve, reject) => {
    execFile('gh', args, {
      shell: false,
      env: cleanEnv(),
      cwd,
      timeout: timeoutMs,
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

// ── Claude Phase Runner ────────────────────────────────────────────────────────

export function runClaudePhase(
  projectPath: string,
  model: string,
  prompt: string,
  taskId: string,
  q: Queries,
  getWindow: GetWindow,
  controller: AbortController,
  timeoutMs: number = 600000
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    if (controller.signal.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return reject(err);
    }

    const modelFlag = model === 'opus' ? 'opus' : 'sonnet';
    const runId = uuidv4();
    q.insertAgentRun.run(runId, taskId, 'phase');

    const task = q.getTask.get(taskId) as TaskRow | undefined;
    const projectName = task?.project_name || '';

    sendLog(q, getWindow, taskId, projectName, `Spawning: claude --model ${modelFlag} --print --permission-mode bypassPermissions (stdin prompt, ${prompt.length} chars, timeout ${Math.round(timeoutMs / 60000)}min)`, 'info');

    const child: ChildProcess = spawn(
      'claude',
      ['--model', modelFlag, '--print', '--permission-mode', 'bypassPermissions'],
      {
        cwd: projectPath,
        env: cleanEnv(),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    // Send prompt via stdin to avoid arg length / shell escaping issues
    child.stdin?.write(prompt);
    child.stdin?.end();

    let output = '';
    let errorOutput = '';
    let timedOut = false;

    // Per-phase timeout
    const timeout = setTimeout(() => {
      timedOut = true;
      sendLog(q, getWindow, taskId, projectName, `Phase timed out after ${Math.round(timeoutMs / 60000)} minutes. Killing process.`, 'error');
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
      q.finishAgentRun.run(result, output, timedOut ? errorOutput + '\n[TIMED_OUT]' : errorOutput, runId);
      if (timedOut) {
        sendLog(q, getWindow, taskId, projectName, `Claude phase timed out`, 'error');
      } else {
        sendLog(q, getWindow, taskId, projectName, `Claude phase exited with code ${code}`, code === 0 ? 'ok' : 'error');
      }
      resolve({ output, exitCode: timedOut ? 1 : (code ?? 1) });
    });

    child.on('error', (err: Error) => {
      clearTimeout(timeout);
      q.finishAgentRun.run('error', output, err.message, runId);
      sendLog(q, getWindow, taskId, projectName, `Spawn error: ${err.message}`, 'error');
      reject(err);
    });

    // Abort handler — kill the subprocess
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
