import type { IpcMain, BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createQueries } from '../../db/queries';
import { readSettingSources } from '../skills';
import type { TaskRow, KnowledgeRow } from './types';
import { activeControllers, specResolvers, planResolvers, pushResolvers, fixTestsResolvers, sendLog, sendPhaseUpdate, getSettingValue } from './state';
import { getEffectiveMaxConcurrent } from '../license';
import { cleanEnv, execFileAsync } from './claude-cli';
import { runRepoAnalysis } from './repo-analysis';
import { orchestrateSddWorkflow } from './orchestrator';
import { runFetchAndFix, runFetchAndFixPushOnly } from './pr-feedback';
import { runTestFixLoop } from './test-runner';
import { fireHook } from '../plugins/engine';

// ── Registration ───────────────────────────────────────────────────────────────

export function registerAgentHandlers(
  ipcMain: IpcMain,
  db: Database.Database,
  getWindow: () => BrowserWindow | null
) {
  const q = createQueries(db);

  // ── Run Agent (start or fetch_fix) ─────────────────────────────────────────
  ipcMain.handle('agent:run', async (_event, taskId: string, phase?: string) => {
    const task = q.getTask.get(taskId) as TaskRow | undefined;
    if (!task) return;

    // Check per-project limit: only 1 active task per project
    const projectActive = (q.getRunningTaskCountByProject.get(task.project_id, taskId) as { count: number }).count;
    if (projectActive > 0 && task.status === 'queued') {
      sendLog(q, getWindow, taskId, task.project_name, `Proyecto "${task.project_name}" ya tiene una tarea activa. Espera a que termine.`, 'info');
      return;
    }

    if (phase === 'fetch_fix') {
      runFetchAndFix(taskId, q, db, getWindow).catch((err) => {
        sendLog(q, getWindow, taskId, '', `Fetch & Fix error: ${err.message}`, 'error');
      });
      return;
    }

    // Check global concurrency limit (enforced by license)
    const maxConcurrent = getEffectiveMaxConcurrent(db);
    const activeCount = (q.getActiveTaskCount.get() as { count: number }).count;
    if (activeCount >= maxConcurrent) {
      sendLog(q, getWindow, taskId, '', `Concurrency limit reached (${maxConcurrent}). Task remains queued.`, 'info');
      return;
    }

    // Determine resume phase: use last_phase if task was stopped or failed mid-workflow
    let resumePhase = 0;
    if (task && task.last_phase > -1 && (task.status === 'queued' || task.status === 'failed')) {
      // Task was stopped or failed mid-workflow — resume from saved phase
      resumePhase = task.last_phase;
    }

    // Start the SDD workflow asynchronously
    orchestrateSddWorkflow(taskId, q, db, getWindow, resumePhase).catch((err) => {
      sendLog(q, getWindow, taskId, '', `Workflow error: ${err.message}`, 'error');
      q.updateTaskStatus.run('failed', taskId);
    });
  });

  // ── Stop Agent ─────────────────────────────────────────────────────────────
  ipcMain.handle('agent:stop', (_event, taskId: string) => {
    const controller = activeControllers.get(taskId);
    if (!controller) {
      console.log(`[agent:stop] No controller found for task ${taskId}. Active controllers: ${[...activeControllers.keys()].join(', ')}`);
      sendLog(q, getWindow, taskId, '', `Stop requested but no active agent found for this task.`, 'error');
      // Force status update anyway
      const task = q.getTask.get(taskId) as TaskRow | undefined;
      if (task && (task.status === 'pr_fixing' || task.status === 'implementing' || task.status === 'reviewing' || task.status === 'fixing' || task.status === 'shipping' || task.status === 'test_fixing')) {
        q.updateTaskStatus.run(task.status === 'pr_fixing' ? 'pr_feedback' : task.status === 'test_fixing' ? 'test_fixing' : 'queued', taskId);
        sendPhaseUpdate(getWindow, { taskId, phase: -1, phaseLabel: 'stopped', status: 'failed' });
      }
      return;
    }
    controller.abort();
    activeControllers.delete(taskId);
    const task = q.getTask.get(taskId) as TaskRow | undefined;
    const prevStatus = task?.status || 'queued';

    // Fire workflow_aborted hook (backup — orchestrator catch also fires this during execution)
    if (task) {
      fireHook('on:workflow_aborted', {
        taskId,
        projectId: task.project_id,
        projectPath: task.project_path,
        taskTitle: task.title,
      }, db).catch(() => {});
    }
    // Save current phase so we can resume from it
    const statusToPhase: Record<string, number> = {
      spec_review: 0, planning: 1, plan_review: 2,
      implementing: 2, reviewing: 3, fixing: 3, shipping: 4,
      pr_feedback: 5, pr_fixing: 5, push_review: 5, test_fixing: 5,
    };
    const phaseNum = statusToPhase[prevStatus] ?? -1;

    // Phase 5 (PR Feedback) is a paused state — return to pr_feedback instead of queued
    if (phaseNum === 5) {
      q.updateTaskStatus.run('pr_feedback', taskId);
      sendLog(q, getWindow, taskId, '', `Agent stopped by user (was: ${prevStatus}). Task returned to PR Feedback.`, 'info');
    } else {
      q.updateTaskLastPhase.run(phaseNum, taskId);
      q.updateTaskStatus.run('queued', taskId);
      sendLog(q, getWindow, taskId, '', `Agent stopped by user (was: ${prevStatus}, phase ${phaseNum}). Will resume from phase ${phaseNum}.`, 'info');
    }
    sendPhaseUpdate(getWindow, {
      taskId,
      phase: -1,
      phaseLabel: 'stopped',
      status: 'failed',
    });
  });

  // ── Continue from Spec Feedback ────────────────────────────────────────────
  ipcMain.handle('agent:continueSpec', async (_event, taskId: string, action: 'accept' | 'edit', editedSpec?: string) => {
    const resolver = specResolvers.get(taskId);
    if (resolver) {
      resolver({ action, editedSpec });
      specResolvers.delete(taskId);
    } else {
      // No pending resolver — restart workflow
      const task = q.getTask.get(taskId) as TaskRow | undefined;

      // Check per-project limit
      if (task) {
        const projectActive = (q.getRunningTaskCountByProject.get(task.project_id, taskId) as { count: number }).count;
        if (projectActive > 0) {
          sendLog(q, getWindow, taskId, task.project_name, `Proyecto "${task.project_name}" ya tiene una tarea activa. Espera a que termine.`, 'info');
          return;
        }
      }

      if (action === 'edit' && editedSpec && task) {
        q.updateTask.run(
          task.title, editedSpec, task.acceptance_criteria, task.images,
          task.model, 'queued', task.pr_number, task.review_cycle,
          task.spec_suggestions, task.plan_summary, task.branch_name, task.pm_work_item_id, task.pm_work_item_url, taskId
        );
      }
      q.updateTaskStatus.run('queued', taskId);
      orchestrateSddWorkflow(taskId, q, db, getWindow, 0).catch((err) => {
        sendLog(q, getWindow, taskId, '', `Workflow error: ${err.message}`, 'error');
        q.updateTaskStatus.run('failed', taskId);
      });
    }
  });

  // ── Continue from Plan Review ─────────────────────────────────────────────
  ipcMain.handle('agent:continuePlan', async (_event, taskId: string, action: 'approve' | 'replan') => {
    const resolver = planResolvers.get(taskId);
    if (resolver) {
      resolver({ action });
      planResolvers.delete(taskId);
    } else {
      // Check per-project limit
      const task = q.getTask.get(taskId) as TaskRow | undefined;
      if (task) {
        const projectActive = (q.getRunningTaskCountByProject.get(task.project_id, taskId) as { count: number }).count;
        if (projectActive > 0) {
          sendLog(q, getWindow, taskId, task.project_name, `Proyecto "${task.project_name}" ya tiene una tarea activa. Espera a que termine.`, 'info');
          return;
        }
      }

      // No pending resolver — restart from appropriate phase
      const startPhase = action === 'approve' ? 2 : 1;
      q.updateTaskStatus.run(startPhase === 2 ? 'implementing' : 'planning', taskId);
      orchestrateSddWorkflow(taskId, q, db, getWindow, startPhase).catch((err) => {
        sendLog(q, getWindow, taskId, '', `Workflow error: ${err.message}`, 'error');
        q.updateTaskStatus.run('failed', taskId);
      });
    }
  });

  // ── Continue from Push Review ─────────────────────────────────────────────
  ipcMain.handle('agent:continuePush', async (_event, taskId: string, action: 'approve' | 'reject' | 'revise', prompt?: string) => {
    const resolver = pushResolvers.get(taskId);
    if (resolver) {
      resolver({ action, prompt });
      pushResolvers.delete(taskId);
    } else {
      // No active resolver — process was killed/restarted. Handle directly.
      const task = q.getTask.get(taskId) as TaskRow | undefined;
      if (!task || task.status !== 'push_review') return;
      const projectPath = task.project_path;
      const projectName = task.project_name;

      if (action === 'reject') {
        sendLog(q, getWindow, taskId, projectName, 'Push rejected by user. Discarding local fix changes.', 'info');
        try {
          await execFileAsync('git', ['checkout', '.'], projectPath, 10000);
          await execFileAsync('git', ['clean', '-fd'], projectPath, 10000);
        } catch { /* ignore */ }
        q.updateTaskStatus.run('pr_feedback', taskId);
        sendPhaseUpdate(getWindow, { taskId, phase: 5, phaseLabel: 'pr_feedback', status: 'completed' });
      } else if (action === 'approve') {
        // Re-launch fetch and fix from push step — just do squash + push
        sendLog(q, getWindow, taskId, projectName, 'Push approved (standalone). Starting squash & push...', 'info');
        q.updateTaskStatus.run('pr_fixing', taskId);
        runFetchAndFixPushOnly(taskId, q, db, getWindow);
      }
    }
  });

  // ── Fix Tests (resume from test_fixing pause) ──────────────────────────────
  ipcMain.handle('agent:fixTests', async (_event, taskId: string) => {
    const resolver = fixTestsResolvers.get(taskId);
    if (resolver) {
      resolver();
      fixTestsResolvers.delete(taskId);
    } else {
      // No pending resolver — re-run the fix tests loop from scratch
      const task = q.getTask.get(taskId) as TaskRow | undefined;
      if (!task) return;

      // Check per-project limit
      const projectActive = (q.getRunningTaskCountByProject.get(task.project_id, taskId) as { count: number }).count;
      if (projectActive > 0) {
        sendLog(q, getWindow, taskId, task.project_name, `Project "${task.project_name}" already has an active task. Wait for it to finish.`, 'info');
        return;
      }

      // Re-run the test fix loop as a standalone operation
      runTestFixLoop(taskId, q, db, getWindow).catch((err) => {
        sendLog(q, getWindow, taskId, '', `Fix Tests error: ${err.message}`, 'error');
        q.updateTaskStatus.run('test_fixing', taskId);
      });
    }
  });

  // ── Refine with AI ──────────────────────────────────────────────────────────
  ipcMain.handle('agent:refineWithAI', async (_event, context: {
    field: 'description' | 'acceptanceCriteria';
    title: string;
    description: string;
    acceptanceCriteria: string;
    projectId: string;
  }) => {
    const project = context.projectId ? q.getProject.get(context.projectId) as { path: string; description: string; name: string } | undefined : undefined;
    const projectPath = project?.path || process.cwd();
    const projectDesc = project?.description || '';
    const knowledge = context.projectId ? (q.getProjectKnowledge.all(context.projectId) || []) as KnowledgeRow[] : [];

    const knowledgeHints = knowledge.slice(0, 10).map((k) =>
      `- [${k.severity}] ${k.title}: ${k.description}`
    ).join('\n');

    let prompt: string;

    if (context.field === 'description') {
      prompt = `You are a senior software architect helping refine a task specification for an SDD (Spec-Driven Development) workflow.

${projectDesc ? `## Project Context\n${projectDesc}\n` : ''}
## Task Title
${context.title || '(no title yet)'}

## Current Spec/Description
${context.description || '(empty — write from scratch based on the title)'}

## Current Acceptance Criteria
${context.acceptanceCriteria || '(none yet)'}

${knowledgeHints ? `## Known Patterns from Past Reviews\n${knowledgeHints}\n` : ''}
## Instructions
Improve the spec/description to make it implementation-ready:
- Be specific about WHAT to build (inputs, outputs, behavior)
- Cover edge cases and error handling
- Mention integrations, data flow, and constraints
- Keep it concise but complete — an engineer should be able to implement from this alone
- Write in the same language as the current description (Spanish or English)

IMPORTANT: Output ONLY the improved description text. No headings, no explanations, no markdown wrappers. Just the refined spec ready to paste.`;
    } else {
      prompt = `You are a senior QA engineer helping define acceptance criteria for an SDD (Spec-Driven Development) task.

${projectDesc ? `## Project Context\n${projectDesc}\n` : ''}
## Task Title
${context.title || '(no title yet)'}

## Task Spec/Description
${context.description || '(no description yet)'}

## Current Acceptance Criteria
${context.acceptanceCriteria || '(empty — write from scratch)'}

${knowledgeHints ? `## Known Patterns from Past Reviews\n${knowledgeHints}\n` : ''}
## Instructions
Generate clear, testable acceptance criteria:
- Each criterion must be verifiable (pass/fail)
- Cover happy path, edge cases, and error scenarios
- Include testing requirements (unit tests, coverage)
- Include code quality requirements when relevant
- One criterion per line, no bullet prefixes
- Write in the same language as the description (Spanish or English)

IMPORTANT: Output ONLY the acceptance criteria, one per line. No headings, no numbering, no markdown. Just the criteria text.`;
    }

    const modelFlag = 'sonnet';
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn('claude', ['--model', modelFlag, '--print'], {
        cwd: projectPath,
        env: cleanEnv(),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('close', (code: number | null) => {
        if (code === 0 && stdout.trim()) resolve(stdout.trim());
        else reject(new Error(stderr.trim() || `Claude exited with code ${code}`));
      });
      child.on('error', (err) => reject(new Error(`Spawn error: ${err.message}`)));

      // Send prompt via stdin to avoid shell escaping / arg length issues
      child.stdin?.write(prompt);
      child.stdin?.end();
    });

    return output;
  });

  // ── Analyze Repo ──────────────────────────────────────────────────────────
  ipcMain.handle('agent:analyzeRepo', async (_event, projectId: string) => {
    const project = q.getProject.get(projectId) as { id: string; name: string; path: string; repo: string | null; description: string; optional_skills: string } | undefined;
    if (!project) throw new Error(`Project ${projectId} not found`);

    console.log(`[analyzeRepo] Starting analysis for project "${project.name}" at ${project.path}`);

    // Read active skills for the project
    const skills = readSettingSources(join(project.path, '.claude', 'settings.json'));

    // Check if CLAUDE.md already exists (merge mode)
    const claudeMdPath = join(project.path, 'CLAUDE.md');
    const existingClaudeMd = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, 'utf-8') : undefined;
    const mode = existingClaudeMd ? 'merge' : 'create';

    console.log(`[analyzeRepo] Mode: ${mode}, skills: ${skills.length}`);
    const result = await runRepoAnalysis(project.path, existingClaudeMd, skills);
    console.log(`[analyzeRepo] Analysis complete. Description: ${result.shortDescription.length} chars, CLAUDE.md: ${result.claudeMdContent.length} chars`);

    // Write CLAUDE.md to project root
    try {
      writeFileSync(claudeMdPath, result.claudeMdContent, 'utf-8');
      console.log(`[analyzeRepo] CLAUDE.md written to ${claudeMdPath}`);
    } catch (err) {
      console.error(`[analyzeRepo] Failed to write CLAUDE.md: ${(err as Error).message}. Saving to DB as fallback.`);
      // Fallback: save full content to DB description
      q.updateProject.run(project.name, project.path, project.repo, result.claudeMdContent, project.optional_skills, (project as Record<string, unknown>).test_command ?? '', (project as Record<string, unknown>).code_hosting ?? null, (project as Record<string, unknown>).plugin_pm ?? null, (project as Record<string, unknown>).plugin_pm_config ?? '{}', project.id);
      return result.shortDescription;
    }

    // Save short description to DB
    q.updateProject.run(project.name, project.path, project.repo, result.shortDescription, project.optional_skills, (project as Record<string, unknown>).test_command ?? '', (project as Record<string, unknown>).code_hosting ?? null, (project as Record<string, unknown>).plugin_pm ?? null, (project as Record<string, unknown>).plugin_pm_config ?? '{}', project.id);

    return result.shortDescription;
  });

  // ── Health Check ───────────────────────────────────────────────────────────
  ipcMain.handle('agent:healthCheck', async () => {
    const results = {
      claudeInstalled: false,
      claudeVersion: undefined as string | undefined,
      ghInstalled: false,
      ghVersion: undefined as string | undefined,
      gitInstalled: false,
      specifyInstalled: false,
    };

    try {
      const claudeVersion = await execFileAsync('claude', ['--version']);
      results.claudeInstalled = true;
      results.claudeVersion = claudeVersion.trim();
    } catch {
      // not installed
    }

    try {
      const ghVersion = await execFileAsync('gh', ['--version']);
      results.ghInstalled = true;
      results.ghVersion = ghVersion.split('\n')[0]?.trim();
    } catch {
      // not installed
    }

    try {
      await execFileAsync('git', ['--version']);
      results.gitInstalled = true;
    } catch {
      // not installed
    }

    {
      const home = process.env.HOME || '';
      const globalSpeckit = join(home, '.claude', 'commands', 'speckit.specify.md');
      results.specifyInstalled = existsSync(globalSpeckit);
    }

    return results;
  });
}
