import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { TaskRow, Queries, GetWindow } from './types';
import { activeControllers, sendLog, sendPhaseUpdate, checkAborted, getSettingValue } from './state';
import { runAgentPhase } from './agents';

// ── Native Test Runner ──────────────────────────────────────────────────────────

export function detectTestCommand(projectPath: string): string | null {
  // Auto-detect test command from project files
  if (existsSync(join(projectPath, 'package.json'))) {
    try {
      const pkg = JSON.parse(readFileSync(join(projectPath, 'package.json'), 'utf-8'));
      if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
        return 'npm test';
      }
    } catch { /* ignore parse errors */ }
  }
  if (existsSync(join(projectPath, 'composer.json'))) return 'composer test';
  if (existsSync(join(projectPath, 'Makefile'))) {
    try {
      const makefile = readFileSync(join(projectPath, 'Makefile'), 'utf-8');
      if (makefile.includes('test:')) return 'make test';
    } catch { /* ignore */ }
  }
  if (existsSync(join(projectPath, 'pytest.ini')) || existsSync(join(projectPath, 'setup.cfg')) || existsSync(join(projectPath, 'pyproject.toml'))) return 'pytest';
  if (existsSync(join(projectPath, 'Cargo.toml'))) return 'cargo test';
  if (existsSync(join(projectPath, 'go.mod'))) return 'go test ./...';
  return null;
}

export async function runNativeTests(
  projectPath: string,
  testCommand: string,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow,
  timeoutMs: number
): Promise<{ pass: boolean; output: string; timedOut: boolean }> {
  const cmd = testCommand.trim() || detectTestCommand(projectPath) || '';
  if (!cmd) {
    sendLog(q, getWindow, taskId, projectName, 'No test command configured or detected. Skipping native tests.', 'info');
    return { pass: true, output: 'No test command configured', timedOut: false };
  }

  sendLog(q, getWindow, taskId, projectName, `Running native tests: ${cmd}`, 'info');

  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'cmd' : '/bin/sh';
    const shellArgs = process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd];

    const child = spawn(shell, shellArgs, {
      cwd: projectPath,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code: number | null) => {
      clearTimeout(timeout);
      const combined = (stdout + '\n' + stderr).trim();
      const last3000 = combined.length > 3000 ? combined.slice(-3000) : combined;

      if (timedOut) {
        sendLog(q, getWindow, taskId, projectName, `Native tests timed out after ${Math.round(timeoutMs / 60000)}min.`, 'info');
        resolve({ pass: false, output: last3000, timedOut: true });
      } else if (code === 0) {
        sendLog(q, getWindow, taskId, projectName, 'Native tests: PASSED', 'ok');
        resolve({ pass: true, output: last3000, timedOut: false });
      } else {
        sendLog(q, getWindow, taskId, projectName, `Native tests: FAILED (exit code ${code})`, 'error');
        resolve({ pass: false, output: last3000, timedOut: false });
      }
    });

    child.on('error', (err: Error) => {
      clearTimeout(timeout);
      sendLog(q, getWindow, taskId, projectName, `Native tests spawn error: ${err.message}`, 'error');
      resolve({ pass: false, output: err.message, timedOut: false });
    });
  });
}

// ── Standalone Test Fix Loop (for agent:fixTests fallback) ──────────────────────

import type Database from 'better-sqlite3';

export async function runTestFixLoop(
  taskId: string,
  q: Queries,
  db: Database.Database,
  getWindow: GetWindow
) {
  const controller = new AbortController();
  activeControllers.set(taskId, controller);

  try {
    const task = q.getTask.get(taskId) as TaskRow | undefined;
    if (!task) throw new Error(`Task ${taskId} not found`);

    const projectPath = task.project_path;
    const workDir = task.worktree_path || projectPath;
    const projectName = task.project_name;
    const model = task.model;
    const proj = q.getProject.get(task.project_id) as { test_command?: string } | undefined;
    const testCmd = (proj as Record<string, unknown>)?.test_command as string || '';
    const testTimeoutMin = getSettingValue(q, 'test_timeout_min', 5);
    const testTimeoutMs = testTimeoutMin * 60000;
    const maxTestFixRetries = getSettingValue(q, 'test_fix_retries', 3);

    q.updateTaskStatus.run('pr_fixing', taskId);
    sendPhaseUpdate(getWindow, {
      taskId, phase: 5, phaseLabel: 'pr_fixing', status: 'started',
    });

    let fixed = false;
    let attempt = 0;

    while (!fixed && attempt < maxTestFixRetries) {
      checkAborted(controller);
      attempt++;

      const testResult = await runNativeTests(workDir, testCmd, taskId, projectName, q, getWindow, testTimeoutMs);
      if (testResult.pass || testResult.timedOut) {
        fixed = true;
        break;
      }

      sendLog(q, getWindow, taskId, projectName, `Fix Tests: Claude attempting fix (${attempt}/${maxTestFixRetries})...`, 'info');
      const fixPrompt = `Tests failed. Fix ONLY the failing tests — do NOT change application logic.
Test command: ${testCmd || detectTestCommand(workDir) || 'npm test'}
Test output (last 3000 chars):
${testResult.output}

Fix the test failures and ensure all tests pass.`;
      await runAgentPhase(db, task.project_id, 5, {
        projectPath: workDir, model, prompt: fixPrompt, taskId, q, getWindow, controller, timeoutMs: 600000,
      });

      const postFixResult = await runNativeTests(workDir, testCmd, taskId, projectName, q, getWindow, testTimeoutMs);
      if (postFixResult.pass || postFixResult.timedOut) {
        fixed = true;
      }
    }

    if (!fixed) {
      sendLog(q, getWindow, taskId, projectName, `Fix Tests: Still failing after ${maxTestFixRetries} attempts. Pausing again.`, 'error');
      q.updateTaskStatus.run('test_fixing', taskId);
      sendPhaseUpdate(getWindow, { taskId, phase: 5, phaseLabel: 'test_fixing', status: 'paused' });
      activeControllers.delete(taskId);
      return;
    }

    sendLog(q, getWindow, taskId, projectName, 'Fix Tests: Tests now passing. Resuming Fetch & Fix workflow.', 'ok');

    // Tests passed — resume the fetch & fix workflow from the push review gate
    // Re-run the full fetch & fix to continue from where it left off
    activeControllers.delete(taskId);
    q.updateTaskStatus.run('pr_feedback', taskId);
    sendPhaseUpdate(getWindow, { taskId, phase: 5, phaseLabel: 'pr_feedback', status: 'completed' });

  } catch (err) {
    activeControllers.delete(taskId);
    if ((err as Error).name === 'AbortError') return;
    q.updateTaskStatus.run('test_fixing', taskId);
    sendLog(q, getWindow, taskId, '', `Fix Tests failed: ${(err as Error).message}`, 'error');
    sendPhaseUpdate(getWindow, { taskId, phase: 5, phaseLabel: 'test_fixing', status: 'paused' });
  }
}
