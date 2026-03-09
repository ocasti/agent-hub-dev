import { spawn, type ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import type { TaskRow } from '../types';
import { sendLog } from '../state';
import { execFileAsync, cleanEnv } from '../claude-cli';
import type { AgentAdapter, AgentRunOptions, AgentRunResult } from './types';

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude';
  readonly name = 'Claude Code';
  readonly binary = 'claude';
  readonly versionArgs = ['--version'];

  async checkInstalled(): Promise<string | null> {
    try {
      const output = await execFileAsync(this.binary, this.versionArgs, undefined, 10000);
      return output.trim();
    } catch {
      return null;
    }
  }

  cleanEnv(extraEnv?: Record<string, string | undefined>): NodeJS.ProcessEnv {
    return cleanEnv(extraEnv);
  }

  runPhase(options: AgentRunOptions): Promise<AgentRunResult> {
    const { projectPath, model, prompt, taskId, q, getWindow, controller, timeoutMs, extraEnv } = options;

    return new Promise((resolve, reject) => {
      if (controller.signal.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        return reject(err);
      }

      const modelFlag = model === 'opus' ? 'opus' : 'sonnet';
      const runId = uuidv4();
      if (taskId) q.insertAgentRun.run(runId, taskId, 'phase');

      const task = taskId ? q.getTask.get(taskId) as TaskRow | undefined : undefined;
      const projectName = task?.project_name || '';

      sendLog(q, getWindow, taskId, projectName,
        `Spawning: claude --model ${modelFlag} --print --permission-mode bypassPermissions (stdin prompt, ${prompt.length} chars, timeout ${Math.round(timeoutMs / 60000)}min)`,
        'info');

      const child: ChildProcess = spawn(
        'claude',
        ['--model', modelFlag, '--print', '--permission-mode', 'bypassPermissions'],
        {
          cwd: projectPath,
          env: this.cleanEnv(extraEnv),
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );

      child.stdin?.write(prompt);
      child.stdin?.end();

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
