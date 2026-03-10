import type Database from 'better-sqlite3';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { TaskRow, KnowledgeRow, Queries, GetWindow } from './types';
import { activeControllers, sendLog, sendPhaseUpdate, checkAborted, getSettingValue, waitForSpecContinue, waitForPlanContinue } from './state';
import { execFileAsync } from './claude-cli';
import { readAgentMd, runRepoAnalysis } from './repo-analysis';
import { runAgentPhase, resolveAgentForPhase, checkSpeckitForAgent } from './agents';
import { readSettingSources } from '../skills';
import { parsePhaseOutput, saveKnowledgeEntries } from './output-parser';
import { buildPhasePrompt, buildFixPrompt } from './prompt-builder';
import { prepareGitBranch, commitWipIfDirty } from './git-ops';
import { createWorktree, setupWorktreeDepsWithSymlink, removeWorktree, mergeWorktreeBranch, detectWorktreeConflicts } from './worktree';
import { fireHook, hasCodeHostingPlugin } from '../plugins/engine';
import type { HookContext } from '../plugins/types';
import { canUseModel, getEffectiveMaxReviewLoops, getMaxParallelPerProject } from '../license';
import { sendNotification } from '../notifications';
import { resolveEnvVars, getProjectAdapter } from './adapters/registry';

// ── SDD Workflow Orchestrator ──────────────────────────────────────────────────

export async function orchestrateSddWorkflow(
  taskId: string,
  q: Queries,
  db: Database.Database,
  getWindow: GetWindow,
  startPhase: number = 0
) {
  const controller = new AbortController();
  activeControllers.set(taskId, controller);

  // Declared outside try so catch block can access for hook context
  let taskProjectId: string | undefined;
  let taskProjectPath: string | undefined;
  let taskTitle: string | undefined;
  let taskWorktreePath: string | undefined; // for cleanup on error

  try {
    const task = q.getTask.get(taskId) as TaskRow | undefined;
    if (!task) throw new Error(`Task ${taskId} not found`);
    taskProjectId = task.project_id;
    taskProjectPath = task.project_path;
    taskTitle = task.title;

    const projectPath = task.project_path;  // original repo (always)
    let workDir = task.worktree_path || projectPath; // effective working directory
    const projectName = task.project_name;
    let projectDescription = readAgentMd(workDir) || task.project_description || '';
    const model = task.model;
    const useWorktree = getMaxParallelPerProject(db) > 1;

    // Validate model against license limits
    if (!canUseModel(db, model)) throw new Error('MODEL_NOT_AVAILABLE');

    // Resolve code hosting env vars (token, author name/email) for all subprocess calls
    const extraEnv = resolveEnvVars(task.project_id, db);

    const criteria = JSON.parse(task.acceptance_criteria || '[]') as string[];
    const knowledge = (q.getProjectKnowledge.all(task.project_id) || []) as KnowledgeRow[];
    const maxReviewLoops = getEffectiveMaxReviewLoops(db);

    const phaseNames = ['Spec Review', 'Plan', 'Implement', 'Quality Gate', 'Ship'];
    const resumeLabel = startPhase > 0 ? ` (resuming from Phase ${startPhase}: ${phaseNames[startPhase] || startPhase})` : '';
    sendLog(q, getWindow, taskId, projectName, `SDD Workflow started for: ${task.title}${resumeLabel}`, 'info');

    // Build hook context for plugin system
    const hookCtx: HookContext = {
      taskId,
      projectId: task.project_id,
      projectPath: projectPath,
      taskTitle: task.title,
      taskDescription: task.description,
      branchName: task.branch_name || undefined,
      prNumber: task.pr_number || undefined,
    };

    await fireHook('on:workflow_started', { ...hookCtx, phase: startPhase }, db);

    // ── SDD: check speckit commands for the resolved agent ──
    // Each agent has its own commands dir: ~/{configFolder}/commands/speckit.*.md
    // Configured via: specify init . --ai {agent}
    const resolvedAgent = resolveAgentForPhase(db, task.project_id, 0);
    const useSpeckit = checkSpeckitForAgent(resolvedAgent.primary.id);
    sendLog(q, getWindow, taskId, projectName,
      useSpeckit
        ? `SDD Kit detected for ${resolvedAgent.primary.name}`
        : `SDD Kit not found for ${resolvedAgent.primary.name} — using built-in SDD prompts. Run "specify init . --ai ${resolvedAgent.primary.id}" to enable.`,
      'info');

    // ── Auto-analyze repo if no AGENT.md (or legacy CLAUDE.md) exists ────
    const agentMdPath = join(workDir, 'AGENT.md');
    const legacyClaudeMdPath = join(workDir, 'CLAUDE.md');
    if (!existsSync(agentMdPath) && !existsSync(legacyClaudeMdPath)) {
      sendLog(q, getWindow, taskId, projectName, `No AGENT.md found. Auto-analyzing repo with ${resolvedAgent.primary.name}...`, 'info');
      try {
        const skills = readSettingSources(join(workDir, '.claude', 'settings.json'));
        const result = await runRepoAnalysis(workDir, undefined, skills, db, task.project_id);
        projectDescription = result.agentMdContent;

        // Write AGENT.md to project root
        writeFileSync(agentMdPath, result.agentMdContent, 'utf-8');

        // Save short description to DB
        const proj = q.getProject.get(task.project_id) as { name: string; path: string; repo: string | null; optional_skills: string; test_command?: string } | undefined;
        if (proj) {
          q.updateProject.run(proj.name, proj.path, proj.repo, result.shortDescription, proj.optional_skills, proj.test_command ?? '', (proj as Record<string, unknown>).code_hosting ?? null, (proj as Record<string, unknown>).code_hosting_config ?? '{}', (proj as Record<string, unknown>).plugin_pm ?? null, (proj as Record<string, unknown>).plugin_pm_config ?? '{}', (proj as Record<string, unknown>).ai_agent ?? 'claude', (proj as Record<string, unknown>).ai_agent_phases ?? '{}', task.project_id);
        }

        sendLog(q, getWindow, taskId, projectName, 'Repo auto-analysis complete. AGENT.md created.', 'ok');
      } catch (err) {
        sendLog(q, getWindow, taskId, projectName, `Repo auto-analysis warning: ${(err as Error).message}. Continuing without context.`, 'info');
      }
    }

    // NOTE: last_phase is preserved from previous run for resume safety.
    // Each phase updates last_phase before running; it resets to -1 only on full success (end of workflow).

    // ── Early Worktree Creation ────────────────────────────────────────────
    // When parallel execution is enabled, create the worktree BEFORE Phase 0 so that
    // spec review (Phase 0) and planning (Phase 1) also run in an isolated directory.
    // Without this, parallel tasks would write spec/plan files to the same project directory.
    if (useWorktree && !task.worktree_path) {
      // If worktree_path was set in DB but directory was removed (e.g. crash), clear it
      // (this check also runs in Phase 2 for non-worktree → worktree transitions)
      const effectiveBranch = (task.branch_name && task.branch_name !== 'unknown') ? task.branch_name : null;

      sendLog(q, getWindow, taskId, projectName, '── Creating isolated worktree for parallel execution ──', 'info');
      const wt = await createWorktree(
        projectPath, taskId, task.title, effectiveBranch, q, getWindow, projectName, extraEnv
      );
      workDir = wt.worktreePath;
      taskWorktreePath = wt.worktreePath;
      task.branch_name = wt.branchName;
      q.updateTaskWorktree.run(wt.worktreePath, taskId);

      // Save branch name early so resume knows the branch
      const freshForWT = q.getTask.get(taskId) as TaskRow | undefined;
      if (freshForWT) {
        q.updateTask.run(
          freshForWT.title, freshForWT.description, freshForWT.acceptance_criteria, freshForWT.images,
          freshForWT.model, freshForWT.status, freshForWT.pr_number, freshForWT.review_cycle,
          freshForWT.spec_suggestions, freshForWT.plan_summary, wt.branchName, freshForWT.pm_work_item_id, freshForWT.pm_work_item_url, taskId
        );
      }

      // Install dependencies in worktree (symlink node_modules when possible)
      await setupWorktreeDepsWithSymlink(workDir, projectPath, taskId, projectName, q, getWindow);

      // Re-read AGENT.md from worktree
      projectDescription = readAgentMd(workDir) || task.project_description || '';

      sendLog(q, getWindow, taskId, projectName, `Worktree ready: ${wt.worktreePath} (branch: ${wt.branchName})`, 'ok');
    } else if (task.worktree_path && !existsSync(task.worktree_path)) {
      // Worktree path was saved but directory is gone — recreate it
      sendLog(q, getWindow, taskId, projectName, 'Worktree directory missing — recreating...', 'info');
      q.updateTaskWorktree.run(null, taskId);
      task.worktree_path = null as unknown as string;
      workDir = projectPath;

      if (useWorktree) {
        const effectiveBranch = (task.branch_name && task.branch_name !== 'unknown') ? task.branch_name : null;
        const wt = await createWorktree(
          projectPath, taskId, task.title, effectiveBranch, q, getWindow, projectName, extraEnv
        );
        workDir = wt.worktreePath;
        taskWorktreePath = wt.worktreePath;
        task.branch_name = wt.branchName;
        q.updateTaskWorktree.run(wt.worktreePath, taskId);
        await setupWorktreeDepsWithSymlink(workDir, projectPath, taskId, projectName, q, getWindow);
        projectDescription = readAgentMd(workDir) || task.project_description || '';
      }
    }

    // ── Ensure correct branch ──────────────────────────────────────────────
    // If task already has a branch (from a previous run), switch to it before any phase.
    // This guarantees we're always working on the task's branch, even when resuming at Phase 3+.
    const freshTask = q.getTask.get(taskId) as TaskRow | undefined;
    const savedBranch = (freshTask?.branch_name && freshTask.branch_name !== 'unknown') ? freshTask.branch_name : null;
    if (savedBranch && startPhase > 0 && !task.worktree_path) {
      // Only needed in non-worktree mode — worktrees are already on the correct branch
      sendLog(q, getWindow, taskId, projectName, `Git: ensuring correct branch (${savedBranch}) before resuming...`, 'info');
      try {
        const currentBranch = (await execFileAsync('git', ['branch', '--show-current'], workDir, 30000, false, extraEnv)).trim();
        if (currentBranch !== savedBranch) {
          await commitWipIfDirty(workDir, taskId, projectName, q, getWindow, extraEnv);
          await execFileAsync('git', ['checkout', savedBranch], workDir, 30000, false, extraEnv);
          sendLog(q, getWindow, taskId, projectName, `Git: switched to branch ${savedBranch}`, 'ok');
        } else {
          sendLog(q, getWindow, taskId, projectName, `Git: already on branch ${savedBranch}`, 'ok');
        }
      } catch (err) {
        sendLog(q, getWindow, taskId, projectName, `Git: branch switch warning: ${(err as Error).message}. Continuing on current branch.`, 'info');
      }
    }

    // ── Phase 0: Spec Review ───────────────────────────────────────────────
    if (startPhase <= 0) {
      checkAborted(controller);
      await fireHook('on:before_spec', { ...hookCtx, phase: 0, phaseLabel: 'spec_review' }, db);
      const status = 'spec_review';
      q.updateTaskLastPhase.run(0, taskId);
      q.updateTaskStatus.run(status, taskId);
      sendPhaseUpdate(getWindow, { taskId, phase: 0, phaseLabel: status, status: 'started' });
      sendLog(q, getWindow, taskId, projectName, '── Phase 0: Spec Review ──', 'info');

      const prompt = buildPhasePrompt(0, task, projectDescription, knowledge, criteria, undefined, useSpeckit);
      const { output, exitCode } = await runAgentPhase(db, task.project_id, 0, {
        projectPath: workDir, model, prompt, taskId, q, getWindow, controller, timeoutMs: 300000, extraEnv,
      });

      if (exitCode !== 0) {
        q.updateTaskStatus.run('failed', taskId);
        sendPhaseUpdate(getWindow, { taskId, phase: 0, phaseLabel: status, status: 'failed' });
        return;
      }

      const parsed = parsePhaseOutput(0, output);

      if (parsed.specIncomplete) {
        // Pause for spec feedback
        const suggestions = parsed.suggestions || [];
        const suggestionsJson = JSON.stringify(suggestions);
        // Save suggestions to task
        q.updateTask.run(
          task.title, task.description, task.acceptance_criteria, task.images,
          task.model, 'spec_feedback', task.pr_number, task.review_cycle,
          suggestionsJson, task.plan_summary, task.branch_name, task.pm_work_item_id, task.pm_work_item_url, taskId
        );
        sendPhaseUpdate(getWindow, {
          taskId, phase: 0, phaseLabel: 'spec_feedback', status: 'paused',
          specSuggestions: suggestions,
        });
        sendLog(q, getWindow, taskId, projectName, `Spec incomplete — ${suggestions.length} suggestion(s). Waiting for user input.`, 'info');
        sendNotification('spec_needs_input', 'Spec needs refinement', `${task.title} — ${suggestions.length} suggestion(s). Review and refine your specification.`);
        await fireHook('on:spec_needs_input', { ...hookCtx, phase: 0, phaseLabel: 'spec_feedback', specSuggestions: suggestions }, db);

        // Wait for user to continue
        const userResponse = await waitForSpecContinue(taskId, controller);

        // Check per-project limit before resuming execution
        const specMaxParallel = getMaxParallelPerProject(db);
        const specProjectRunning = (q.getRunningTaskCountByProject.get(task.project_id, taskId) as { count: number }).count;
        if (specProjectRunning >= specMaxParallel) {
          sendLog(q, getWindow, taskId, projectName, `Project "${projectName}" has reached its parallel limit (${specMaxParallel}). Spec processed but task will wait in queue.`, 'info');
          if (userResponse.action === 'edit' && userResponse.editedSpec) {
            q.updateTask.run(
              task.title, userResponse.editedSpec, task.acceptance_criteria, task.images,
              task.model, 'queued', task.pr_number, task.review_cycle,
              '[]', null, task.branch_name, task.pm_work_item_id, task.pm_work_item_url, taskId
            );
          } else {
            q.updateTaskStatus.run('queued', taskId);
          }
          q.updateTaskLastPhase.run(0, taskId); // Resume from Phase 0 when started again
          sendPhaseUpdate(getWindow, { taskId, phase: 0, phaseLabel: 'queued', status: 'paused' });
          activeControllers.delete(taskId);
          return;
        }

        if (userResponse.action === 'edit' && userResponse.editedSpec) {
          // Update task description and restart from phase 0
          q.updateTask.run(
            task.title, userResponse.editedSpec, task.acceptance_criteria, task.images,
            task.model, 'queued', task.pr_number, task.review_cycle,
            '[]', null, task.branch_name, taskId
          );
          sendLog(q, getWindow, taskId, projectName, 'Spec updated by user. Restarting from Phase 0.', 'info');
          activeControllers.delete(taskId);
          return orchestrateSddWorkflow(taskId, q, db, getWindow, 0);
        }
        // action === 'accept' → continue to Phase 1
        sendLog(q, getWindow, taskId, projectName, 'Spec accepted by user. Continuing to Phase 1.', 'info');
      }

      sendPhaseUpdate(getWindow, { taskId, phase: 0, phaseLabel: status, status: 'completed' });
      await fireHook('on:spec_complete', { ...hookCtx, phase: 0, phaseLabel: 'spec_review' }, db);
    }

    // ── Phase 1: Plan ──────────────────────────────────────────────────────
    if (startPhase <= 1) {
      checkAborted(controller);
      q.updateTaskLastPhase.run(1, taskId);
      q.updateTaskStatus.run('planning', taskId);
      sendPhaseUpdate(getWindow, { taskId, phase: 1, phaseLabel: 'planning', status: 'started' });
      sendLog(q, getWindow, taskId, projectName, '── Phase 1: Plan ──', 'info');

      const planPrompt = buildPhasePrompt(1, task, projectDescription, knowledge, criteria, undefined, useSpeckit);
      const { output: planOutput, exitCode: planExit } = await runAgentPhase(db, task.project_id, 1, {
        projectPath: workDir, model, prompt: planPrompt, taskId, q, getWindow, controller, timeoutMs: 600000, extraEnv,
      });

      if (planExit !== 0) {
        q.updateTaskStatus.run('failed', taskId);
        sendPhaseUpdate(getWindow, { taskId, phase: 1, phaseLabel: 'planning', status: 'failed' });
        throw new Error('Phase 1 (planning) failed');
      }

      sendPhaseUpdate(getWindow, { taskId, phase: 1, phaseLabel: 'planning', status: 'completed' });

      // ── Plan Review Gate: pause for user approval ──
      // Capture a summary of the plan output (first ~2000 chars)
      const planSummary = planOutput.trim().substring(0, 2000);
      q.updateTask.run(
        task.title, task.description, task.acceptance_criteria, task.images,
        task.model, 'plan_review', task.pr_number, task.review_cycle,
        task.spec_suggestions, planSummary, task.branch_name, task.pm_work_item_id, task.pm_work_item_url, taskId
      );
      sendPhaseUpdate(getWindow, {
        taskId, phase: 1, phaseLabel: 'plan_review', status: 'paused',
        planSummary,
      });
      sendLog(q, getWindow, taskId, projectName, 'Plan ready — waiting for user approval before implementing.', 'info');
      sendNotification('plan_ready', 'Plan ready for review', `${task.title} — Review and approve the plan before implementation begins.`);
      await fireHook('on:plan_ready', { ...hookCtx, phase: 1, phaseLabel: 'plan_review', planSummary }, db);

      // Wait for user to approve or request re-plan
      const planResponse = await waitForPlanContinue(taskId, controller);

      if (planResponse.action === 'replan') {
        sendLog(q, getWindow, taskId, projectName, 'User requested re-plan. Restarting Phase 1.', 'info');
        activeControllers.delete(taskId);
        return orchestrateSddWorkflow(taskId, q, db, getWindow, 1);
      }

      // Check per-project limit before resuming execution
      const maxParallel = getMaxParallelPerProject(db);
      const projectRunning = (q.getRunningTaskCountByProject.get(task.project_id, taskId) as { count: number }).count;
      if (projectRunning >= maxParallel) {
        sendLog(q, getWindow, taskId, projectName, `Project "${projectName}" has reached its parallel limit (${maxParallel}). Plan approved but task will wait in queue.`, 'info');
        q.updateTaskStatus.run('queued', taskId);
        q.updateTaskLastPhase.run(2, taskId); // Resume from Phase 2 when started again
        sendPhaseUpdate(getWindow, { taskId, phase: 1, phaseLabel: 'queued', status: 'paused' });
        activeControllers.delete(taskId);
        return;
      }

      // action === 'approve' → continue to Phase 2
      sendLog(q, getWindow, taskId, projectName, 'Plan approved by user. Continuing to Phase 2: Implement.', 'ok');
      await fireHook('on:plan_approved', { ...hookCtx, phase: 1, phaseLabel: 'planning' }, db);
    }

    // ── Git Preparation: ensure clean feature branch before implementing ──
    // Worktree mode: branch was already created during early worktree setup (before Phase 0).
    // Classic mode: create feature branch now, before implementation begins.
    if (startPhase <= 2 && !taskWorktreePath) {
      checkAborted(controller);
      sendLog(q, getWindow, taskId, projectName, '── Git: Preparing feature branch ──', 'info');

      const branchName = await prepareGitBranch(
        workDir, task.title, task.branch_name, taskId, projectName, q, getWindow, extraEnv
      );

      // Save branch name to task so resume can use it
      const freshForBranch = q.getTask.get(taskId) as TaskRow | undefined;
      if (freshForBranch) {
        q.updateTask.run(
          freshForBranch.title, freshForBranch.description, freshForBranch.acceptance_criteria, freshForBranch.images,
          freshForBranch.model, freshForBranch.status, freshForBranch.pr_number, freshForBranch.review_cycle,
          freshForBranch.spec_suggestions, freshForBranch.plan_summary, branchName, freshForBranch.pm_work_item_id, freshForBranch.pm_work_item_url, taskId
        );
      }
    }

    // Worktree mode: detect conflicts with other active worktrees before implementing
    if (startPhase <= 2 && taskWorktreePath) {
      try {
        const conflicts = await detectWorktreeConflicts(projectPath, task.project_id, db, extraEnv);
        if (conflicts.length > 0) {
          const summary = conflicts.slice(0, 5).map(c => `${c.file} (${c.branches.length} branches)`).join(', ');
          sendLog(q, getWindow, taskId, projectName, `Worktree conflict warning: ${conflicts.length} file(s) modified in multiple branches: ${summary}`, 'info');
          sendNotification('regression_detected', 'Worktree conflict detected', `${task.title} — ${conflicts.length} file(s) overlap with other active branches. Review before merging.`);
        }
      } catch {
        // Non-critical — continue workflow
      }
    }

    // ── Phase 2: Implement ─────────────────────────────────────────────────
    if (startPhase <= 2) {
      checkAborted(controller);
      q.updateTaskLastPhase.run(2, taskId);
      await runSimplePhase(2, 'implementing', taskId, task, workDir, projectName, projectDescription, model, knowledge, criteria, q, getWindow, controller, useSpeckit, extraEnv, db);
      await fireHook('on:implement_complete', { ...hookCtx, phase: 2, phaseLabel: 'implementing' }, db);
    }

    // ── Phase 3: Quality Gate (loop) ───────────────────────────────────────
    if (startPhase <= 3) {
      checkAborted(controller);
      q.updateTaskLastPhase.run(3, taskId);
      // Resume review loop from DB to avoid losing progress on restart
      const freshForReview = q.getTask.get(taskId) as TaskRow | undefined;
      let reviewLoop = (startPhase === 3 && freshForReview) ? freshForReview.review_cycle : 0;
      let passed = false;

      while (!passed && reviewLoop < maxReviewLoops) {
        checkAborted(controller);
        q.updateTaskStatus.run('reviewing', taskId);
        sendPhaseUpdate(getWindow, { taskId, phase: 3, phaseLabel: 'reviewing', status: 'started', reviewLoop });
        sendLog(q, getWindow, taskId, projectName, `── Phase 3: Quality Gate (loop ${reviewLoop + 1}/${maxReviewLoops}) ──`, 'info');
        await fireHook('on:review_started', { ...hookCtx, phase: 3, phaseLabel: 'reviewing', reviewLoop }, db);

        const prompt = buildPhasePrompt(3, task, projectDescription, knowledge, criteria, reviewLoop, useSpeckit);
        const { output, exitCode } = await runAgentPhase(db, task.project_id, 3, {
          projectPath: workDir, model, prompt, taskId, q, getWindow, controller, timeoutMs: 900000, extraEnv,
        });

        if (exitCode !== 0) {
          q.updateTaskStatus.run('failed', taskId);
          sendPhaseUpdate(getWindow, { taskId, phase: 3, phaseLabel: 'reviewing', status: 'failed', reviewLoop });
          return;
        }

        const parsed = parsePhaseOutput(3, output);

        // Save knowledge entries if found
        if (parsed.knowledgeEntries && parsed.knowledgeEntries.length > 0) {
          saveKnowledgeEntries(parsed.knowledgeEntries, task.project_id, taskId, q);
        }

        // Save per-criterion status
        if (parsed.criteriaStatus && parsed.criteriaStatus.length > 0) {
          q.updateCriteriaStatus.run(JSON.stringify(parsed.criteriaStatus), taskId);
        }

        if (parsed.reviewPass) {
          passed = true;
          sendPhaseUpdate(getWindow, { taskId, phase: 3, phaseLabel: 'reviewing', status: 'completed', reviewLoop });
          sendLog(q, getWindow, taskId, projectName, 'Quality Gate PASSED', 'ok');
          sendNotification('quality_pass', 'Quality gate passed!', `${task.title} — Code review complete after ${reviewLoop + 1} loop(s).`);
        } else {
          sendNotification('quality_fail', 'Code review found issues', `${task.title} — ${(parsed.issues || []).length} issue(s) found. Attempting fixes...`);
          await fireHook('on:quality_fail', { ...hookCtx, phase: 3, phaseLabel: 'reviewing', reviewLoop, extra: { issues: parsed.issues } }, db);
          reviewLoop++;
          if (reviewLoop < maxReviewLoops) {
            // Run fix phase
            q.updateTaskStatus.run('fixing', taskId);
            sendPhaseUpdate(getWindow, { taskId, phase: 3, phaseLabel: 'fixing', status: 'started', reviewLoop });
            sendLog(q, getWindow, taskId, projectName, `Issues found. Fixing (attempt ${reviewLoop}/${maxReviewLoops})...`, 'info');

            const issuesText = (parsed.issues || []).map((i) => `- [${i.category}] ${i.description}`).join('\n');
            const fixPrompt = buildFixPrompt(task, projectDescription, knowledge, criteria, issuesText);
            const fixResult = await runAgentPhase(db, task.project_id, 3, {
              projectPath: workDir, model, prompt: fixPrompt, taskId, q, getWindow, controller, timeoutMs: 900000, extraEnv,
            });

            if (fixResult.exitCode !== 0) {
              q.updateTaskStatus.run('failed', taskId);
              sendPhaseUpdate(getWindow, { taskId, phase: 3, phaseLabel: 'fixing', status: 'failed', reviewLoop });
              return;
            }

            sendPhaseUpdate(getWindow, { taskId, phase: 3, phaseLabel: 'fixing', status: 'completed', reviewLoop });
          } else {
            sendLog(q, getWindow, taskId, projectName, `Max review loops reached (${reviewLoop}/${maxReviewLoops}). Proceeding to Ship.`, 'info');
            sendNotification('max_review_loops', 'Max review loops reached', `${task.title} — Quality gate could not pass after ${reviewLoop} attempts. Proceeding anyway.`);
            await fireHook('on:quality_max_loops', { ...hookCtx, phase: 3, phaseLabel: 'reviewing', reviewLoop }, db);
            sendPhaseUpdate(getWindow, { taskId, phase: 3, phaseLabel: 'reviewing', status: 'completed', reviewLoop });
          }
        }

        // Update review_cycle in DB
        const freshTaskReview = q.getTask.get(taskId) as TaskRow | undefined;
        if (freshTaskReview) {
          q.updateTask.run(
            freshTaskReview.title, freshTaskReview.description, freshTaskReview.acceptance_criteria, freshTaskReview.images,
            freshTaskReview.model, freshTaskReview.status, freshTaskReview.pr_number, reviewLoop,
            freshTaskReview.spec_suggestions, freshTaskReview.plan_summary, freshTaskReview.branch_name, freshTaskReview.pm_work_item_id, freshTaskReview.pm_work_item_url, taskId
          );
        }
      }
    }

    // Fire hooks after Quality Gate
    if (startPhase <= 3) {
      await fireHook('on:quality_pass', { ...hookCtx, phase: 3, phaseLabel: 'reviewing' }, db);
      await fireHook('on:core_complete', { ...hookCtx, phase: 3 }, db);
    }

    // ── Phase 4: Ship (only if code-hosting plugin is active) ──────────────
    const hasCodeHosting = hasCodeHostingPlugin(task.project_id, db);
    if (startPhase <= 4 && hasCodeHosting) {
      checkAborted(controller);
      q.updateTaskLastPhase.run(4, taskId);
      q.updateTaskStatus.run('shipping', taskId);
      sendPhaseUpdate(getWindow, { taskId, phase: 4, phaseLabel: 'shipping', status: 'started' });
      sendLog(q, getWindow, taskId, projectName, '── Phase 4: Ship ──', 'info');
      await fireHook('on:ship_started', { ...hookCtx, phase: 4, phaseLabel: 'shipping' }, db);

      const prompt = buildPhasePrompt(4, task, projectDescription, knowledge, criteria, undefined, useSpeckit);
      const { output, exitCode } = await runAgentPhase(db, task.project_id, 4, {
        projectPath: workDir, model, prompt, taskId, q, getWindow, controller, timeoutMs: 600000, extraEnv,
      });

      if (exitCode !== 0) {
        await fireHook('on:ship_failed', { ...hookCtx, phase: 4, phaseLabel: 'shipping', error: 'Ship phase failed' }, db);
        q.updateTaskStatus.run('failed', taskId);
        sendPhaseUpdate(getWindow, { taskId, phase: 4, phaseLabel: 'shipping', status: 'failed' });
        return;
      }

      const parsed = parsePhaseOutput(4, output);

      // Update task with PR number and branch
      const freshTaskShip = q.getTask.get(taskId) as TaskRow | undefined;
      if (freshTaskShip) {
        q.updateTask.run(
          freshTaskShip.title, freshTaskShip.description, freshTaskShip.acceptance_criteria, freshTaskShip.images,
          freshTaskShip.model, 'pr_feedback', parsed.prNumber || freshTaskShip.pr_number,
          freshTaskShip.review_cycle, freshTaskShip.spec_suggestions, freshTaskShip.plan_summary,
          parsed.branchName || freshTaskShip.branch_name, freshTaskShip.pm_work_item_id, freshTaskShip.pm_work_item_url, taskId
        );
      }

      q.updateTaskStatus.run('pr_feedback', taskId);
      sendPhaseUpdate(getWindow, {
        taskId, phase: 4, phaseLabel: 'shipping', status: 'completed',
        prNumber: parsed.prNumber,
        branchName: parsed.branchName,
      });
      sendLog(q, getWindow, taskId, projectName,
        `Ship complete. PR #${parsed.prNumber || '?'} on branch ${parsed.branchName || '?'}. Waiting for human review.`,
        'ok'
      );
      sendNotification('pr_created', 'Pull request created!', `${task.title} — PR #${parsed.prNumber || '?'} on ${parsed.branchName || '?'}. Awaiting review.`);
      await fireHook('on:pr_created', { ...hookCtx, phase: 4, phaseLabel: 'shipping', prNumber: parsed.prNumber || undefined, branchName: parsed.branchName || undefined }, db);
    }

    activeControllers.delete(taskId);
    q.updateTaskLastPhase.run(-1, taskId);

    if (hasCodeHosting) {
      sendLog(q, getWindow, taskId, projectName, 'SDD Workflow paused — awaiting PR review.', 'info');
      // Keep worktree alive for PR feedback phase
    } else {
      // No code-hosting plugin → workflow ends at Quality Gate
      const wtPath = taskWorktreePath || task.worktree_path;
      const branchForMerge = task.branch_name;

      // Auto-merge if worktree mode
      if (wtPath && branchForMerge) {
        sendLog(q, getWindow, taskId, projectName, 'Auto-merge: attempting to merge branch into default...', 'info');
        const mergeResult = await mergeWorktreeBranch(projectPath, branchForMerge, extraEnv);
        if (mergeResult.success) {
          sendLog(q, getWindow, taskId, projectName, `Auto-merge: ${mergeResult.message}`, 'ok');
        } else {
          sendLog(q, getWindow, taskId, projectName, `Auto-merge skipped: ${mergeResult.message}. Branch preserved for manual merge.`, 'info');
          sendNotification('task_complete', 'Task completed (merge needed)', `${task.title} — Completed but branch needs manual merge.`);
        }
      }

      // Clean up worktree
      if (wtPath) {
        sendLog(q, getWindow, taskId, projectName, 'Cleaning up worktree...', 'info');
        await removeWorktree(projectPath, wtPath, extraEnv).catch(() => {});
        q.updateTaskWorktree.run(null, taskId);
      }
      q.updateTaskStatus.run('completed', taskId);
      sendPhaseUpdate(getWindow, { taskId, phase: 3, phaseLabel: 'completed', status: 'completed' });
      sendLog(q, getWindow, taskId, projectName, 'SDD Workflow completed (no code-hosting plugin — git/PR handled manually).', 'ok');
      sendNotification('task_complete', 'Task completed!', `${task.title} — Development complete. Code is ready.`);
      await fireHook('on:task_complete', { ...hookCtx, phase: 3 }, db);
    }

  } catch (err) {
    activeControllers.delete(taskId);
    if ((err as Error).name === 'AbortError') {
      // Abort: keep worktree alive so user can resume
      sendLog(q, getWindow, taskId, '', 'Workflow aborted', 'info');
      sendNotification('workflow_aborted', 'Task stopped', `${taskTitle || 'Task'} — Workflow stopped by user.`);
      fireHook('on:workflow_aborted', { taskId, projectId: taskProjectId, projectPath: taskProjectPath, taskTitle }, db).catch(() => {});
      return;
    }
    // Fatal failure: clean up worktree
    if (taskWorktreePath && taskProjectPath) {
      removeWorktree(taskProjectPath, taskWorktreePath).catch(() => {});
      q.updateTaskWorktree.run(null, taskId);
    }
    q.updateTaskStatus.run('failed', taskId);
    sendLog(q, getWindow, taskId, '', `Workflow failed: ${(err as Error).message}`, 'error');
    sendPhaseUpdate(getWindow, { taskId, phase: -1, phaseLabel: 'failed', status: 'failed' });
    sendNotification('workflow_failed', 'Task failed', `${taskTitle || 'Task'} — ${(err as Error).message}`);
    fireHook('on:workflow_failed', { taskId, projectId: taskProjectId, projectPath: taskProjectPath, taskTitle, error: (err as Error).message }, db).catch(() => {});
  }
}

// ── Simple Phase Runner (Phase 1, 2) ───────────────────────────────────────────

export async function runSimplePhase(
  phaseNum: number,
  statusLabel: string,
  taskId: string,
  task: TaskRow,
  projectPath: string,
  projectName: string,
  projectDescription: string,
  model: string,
  knowledge: KnowledgeRow[],
  criteria: string[],
  q: Queries,
  getWindow: GetWindow,
  controller: AbortController,
  useSpeckit?: boolean,
  extraEnv?: Record<string, string | undefined>,
  db?: Database.Database
) {
  q.updateTaskStatus.run(statusLabel, taskId);
  sendPhaseUpdate(getWindow, { taskId, phase: phaseNum, phaseLabel: statusLabel, status: 'started' });
  sendLog(q, getWindow, taskId, projectName, `── Phase ${phaseNum}: ${statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)} ──`, 'info');

  const phaseTimeouts: Record<number, number> = { 1: 600000, 2: 1800000 };
  const prompt = buildPhasePrompt(phaseNum, task, projectDescription, knowledge, criteria, undefined, useSpeckit);
  const timeoutMs = phaseTimeouts[phaseNum] || 600000;

  const { exitCode } = await runAgentPhase(db!, task.project_id, phaseNum, {
    projectPath, model, prompt, taskId, q, getWindow, controller, timeoutMs, extraEnv,
  });

  if (exitCode !== 0) {
    q.updateTaskStatus.run('failed', taskId);
    sendPhaseUpdate(getWindow, { taskId, phase: phaseNum, phaseLabel: statusLabel, status: 'failed' });
    throw new Error(`Phase ${phaseNum} (${statusLabel}) failed with exit code ${exitCode}`);
  }

  sendPhaseUpdate(getWindow, { taskId, phase: phaseNum, phaseLabel: statusLabel, status: 'completed' });
}
