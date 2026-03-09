import type Database from 'better-sqlite3';
import type { TaskRow, KnowledgeRow, Queries, GetWindow } from './types';
import { activeControllers, sendLog, sendPhaseUpdate, checkAborted, getSettingValue, waitForPushApproval, waitForFixTests } from './state';
import { execFileAsync, runClaudePhase } from './claude-cli';
import { readClaudeMd } from './repo-analysis';
import { parsePhaseOutput, saveKnowledgeEntries } from './output-parser';
import { buildSingleThreadPrompt } from './prompt-builder';
import { commitWipIfDirty, getDefaultBranch } from './git-ops';
import { fetchUnresolvedPrFeedback, postThreadReplies, resolveReviewThreads, minimizeOldReviews, cleanupOldPRComments } from './github-api';
import { runNativeTests, detectTestCommand } from './test-runner';
import { execGraphQL } from './claude-cli';
import { fireHook } from '../plugins/engine';
import type { HookContext } from '../plugins/types';
import { resolveEnvVars } from './adapters/registry';
import { sendNotification } from '../notifications';

// ── Fetch & Fix (PR Feedback → re-run phases 2-4) ─────────────────────────────

export async function runFetchAndFix(
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
    if (!task.pr_number) throw new Error('No PR number on task');

    const projectPath = task.project_path;
    const projectName = task.project_name;
    const projectDescription = readClaudeMd(projectPath) || task.project_description || '';
    const model = task.model;
    const criteria = JSON.parse(task.acceptance_criteria || '[]') as string[];
    const knowledge = (q.getProjectKnowledge.all(task.project_id) || []) as KnowledgeRow[];

    // Resolve code hosting env vars for all subprocess calls
    const extraEnv = resolveEnvVars(task.project_id, db);

    // Check per-project limit: no other task actively running on this project
    const projectRunning = (q.getRunningTaskCountByProject.get(task.project_id, taskId) as { count: number }).count;
    if (projectRunning > 0) {
      sendLog(q, getWindow, taskId, projectName, `Proyecto "${projectName}" tiene otra tarea ejecutandose. Fetch & Fix no puede iniciar.`, 'info');
      activeControllers.delete(taskId);
      return;
    }

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

    sendLog(q, getWindow, taskId, projectName, '── Fetch & Fix: Reading PR comments ──', 'info');
    q.updateTaskStatus.run('pr_fixing', taskId);
    sendPhaseUpdate(getWindow, { taskId, phase: 5, phaseLabel: 'pr_fixing', status: 'started' });

    // Ensure we're on the task's branch before fixing
    if (task.branch_name) {
      try {
        const currentBranch = (await execFileAsync('git', ['branch', '--show-current'], projectPath, 30000, false, extraEnv)).trim();
        if (currentBranch !== task.branch_name) {
          await commitWipIfDirty(projectPath, taskId, projectName, q, getWindow, extraEnv);
          await execFileAsync('git', ['checkout', task.branch_name], projectPath, 30000, false, extraEnv);
          sendLog(q, getWindow, taskId, projectName, `Git: on branch ${task.branch_name}`, 'ok');
        } else {
          sendLog(q, getWindow, taskId, projectName, `Git: already on branch ${task.branch_name}`, 'ok');
        }
      } catch (err) {
        sendLog(q, getWindow, taskId, projectName, `Git: branch switch warning: ${(err as Error).message}. Continuing on current branch.`, 'info');
      }
    }

    // Create annotated rollback tag with thread count for cross-cycle regression detection
    const rollbackTag = `agent-hub/pre-fix-cycle-${task.review_cycle + 1}`;
    try {
      await execFileAsync('git', ['tag', '-d', rollbackTag], projectPath, 5000, false, extraEnv).catch(() => {});
    } catch { /* tag didn't exist */ }
    // Tag will be created after we know the thread count (below)

    // Get branch commit history for regression prevention across cycles
    let branchHistory = '';
    try {
      // Try common base branches to get the full commit log of this feature branch
      for (const base of ['main', 'master', 'develop']) {
        try {
          branchHistory = (await execFileAsync('git', ['log', '--oneline', `${base}..HEAD`], projectPath, 10000, false, extraEnv)).trim();
          if (branchHistory) break;
        } catch { /* try next base */ }
      }
    } catch { /* ignore — branchHistory stays empty */ }

    // Capture baseline diff size for post-fix validation
    let baselineDiffLines = 0;
    try {
      const diffStat = (await execFileAsync('git', ['diff', '--shortstat', 'HEAD'], projectPath, 10000, false, extraEnv)).trim();
      const linesMatch = diffStat.match(/(\d+) insertion|(\d+) deletion/g);
      if (linesMatch) {
        for (const m of linesMatch) {
          const num = parseInt(m, 10);
          if (!isNaN(num)) baselineDiffLines += num;
        }
      }
    } catch { /* ignore — baseline stays 0 */ }

    // Fetch PR feedback: general comments + unresolved review threads (structured)
    const feedback = await fetchUnresolvedPrFeedback(
      projectPath, task.pr_number, taskId, projectName, q, getWindow, extraEnv
    );

    const totalItems = feedback.threads.length + (feedback.generalComments.trim() ? 1 : 0);

    // ── Classify severity from threads AND general comments ─────────────
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    const severityRegex = {
      critical: /\bcritical\b|🔴|severity:\s*critical/i,
      high: /\bbug\b|🐛|\bhigh\b|⚠️|severity:\s*high|\bsecurity\s+vulnerabilit/i,
      medium: /\bmedium\b|severity:\s*medium/i,
    };
    // Classify each thread
    for (const thread of feedback.threads) {
      const text = thread.comments.map((c) => c.body).join(' ');
      if (severityRegex.critical.test(text)) severityCounts.critical++;
      else if (severityRegex.high.test(text)) severityCounts.high++;
      else if (severityRegex.medium.test(text)) severityCounts.medium++;
      else severityCounts.low++;
    }
    // Classify general comments (review bodies) — may mention severity not in threads
    if (feedback.generalComments.trim()) {
      const gcText = feedback.generalComments;
      // Count severity mentions in general comments (each match counts as one)
      const gcCritical = (gcText.match(new RegExp(severityRegex.critical.source, 'gi')) || []).length;
      const gcHigh = (gcText.match(new RegExp(severityRegex.high.source, 'gi')) || []).length;
      const gcMedium = (gcText.match(new RegExp(severityRegex.medium.source, 'gi')) || []).length;
      severityCounts.critical += gcCritical;
      severityCounts.high += gcHigh;
      severityCounts.medium += gcMedium;
      if (gcCritical + gcHigh + gcMedium > 0) {
        sendLog(q, getWindow, taskId, projectName,
          `General comments severity: ${gcCritical} critical, ${gcHigh} high, ${gcMedium} medium mentions.`,
          (gcCritical + gcHigh > 0) ? 'error' : 'info'
        );
      }
    }
    const hasCriticalOrHigh = severityCounts.critical > 0 || severityCounts.high > 0;
    sendLog(q, getWindow, taskId, projectName,
      `Total severity: ${severityCounts.critical} critical, ${severityCounts.high} high, ${severityCounts.medium} medium, ${severityCounts.low} low (${feedback.threads.length} threads + general comments)`,
      hasCriticalOrHigh ? 'error' : 'info'
    );

    // ── Cross-cycle regression detection ──────────────────────────────────
    // Regression = thread count increased OR critical/high severity appeared
    if (task.review_cycle > 0 && feedback.threads.length > 0) {
      const prevTag = `agent-hub/pre-fix-cycle-${task.review_cycle}`;
      try {
        const tagMsg = (await execFileAsync('git', ['tag', '-l', '--format=%(contents)', prevTag], projectPath, 5000, false, extraEnv)).trim();
        const prevMatch = tagMsg.match(/threads:(\d+)/);
        const prevCritical = parseInt(tagMsg.match(/critical:(\d+)/)?.[1] || '0', 10);
        const prevHigh = parseInt(tagMsg.match(/high:(\d+)/)?.[1] || '0', 10);

        if (prevMatch) {
          const prevThreadCount = parseInt(prevMatch[1], 10);
          const currentThreadCount = feedback.threads.length;

          sendLog(q, getWindow, taskId, projectName,
            `Regression check: cycle ${task.review_cycle} had ${prevThreadCount} threads (${prevCritical} critical, ${prevHigh} high), now ${currentThreadCount} threads (${severityCounts.critical} critical, ${severityCounts.high} high).`,
            'info'
          );

          // Regression triggers:
          // 1. Critical or high severity threads appeared (were 0 before)
          // 2. Thread count increased significantly
          // 3. Critical/high count increased
          const severityEscalated = (severityCounts.critical > prevCritical) || (severityCounts.high > prevHigh);
          const countEscalated = currentThreadCount > prevThreadCount * 2 && currentThreadCount > prevThreadCount + 5;
          const newCriticalOrHigh = hasCriticalOrHigh && (prevCritical + prevHigh === 0);

          let rollbackReason = '';
          if (newCriticalOrHigh) {
            rollbackReason = `Previous fixes introduced ${severityCounts.critical} critical and ${severityCounts.high} high severity issues (were 0 before).`;
          } else if (severityEscalated) {
            rollbackReason = `Severity escalated: critical ${prevCritical}→${severityCounts.critical}, high ${prevHigh}→${severityCounts.high}.`;
          } else if (countEscalated) {
            rollbackReason = `Thread count escalated from ${prevThreadCount} to ${currentThreadCount} (${Math.round(currentThreadCount / prevThreadCount)}x).`;
          }

          if (rollbackReason) {
            sendLog(q, getWindow, taskId, projectName, `REGRESSION DETECTED: ${rollbackReason} Rolling back.`, 'error');
            sendNotification('regression_detected', 'Regression detected — rolling back', `${task.title} — ${rollbackReason}`);

            try {
              await execFileAsync('git', ['reset', '--hard', prevTag], projectPath, 15000, false, extraEnv);
              await execFileAsync('git', ['push', '--force-with-lease'], projectPath, 30000, false, extraEnv);
              sendLog(q, getWindow, taskId, projectName,
                `Rollback complete. Branch reverted to before cycle ${task.review_cycle}.`,
                'ok'
              );

              // Close all open threads — re-fetch after force push since old IDs are invalidated
              const prRollbackMsg = `Automatically reverted cycle ${task.review_cycle}. Reason: ${rollbackReason} Code has been rolled back to pre-fix state. These comments no longer apply to the current code.`;
              try {
                const repoJson = await execFileAsync('gh', ['repo', 'view', '--json', 'owner,name'], projectPath, 30000, false, extraEnv);
                const repoInfo = JSON.parse(repoJson.trim()) as { owner: { login: string }; name: string };
                const freshQuery = `query($owner: String!, $name: String!, $pr: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) { reviewThreads(first: 100) { nodes { id isResolved } } } } }`;
                const freshOutput = await execGraphQL(freshQuery, projectPath, 10000, { owner: repoInfo.owner.login, name: repoInfo.name, pr: task.pr_number as number }, extraEnv);
                const freshData = JSON.parse(freshOutput) as { data: { repository: { pullRequest: { reviewThreads: { nodes: { id: string; isResolved: boolean }[] } } } } };
                const freshUnresolved = freshData.data.repository.pullRequest.reviewThreads.nodes.filter((t) => !t.isResolved);
                const freshIds = freshUnresolved.map((t) => t.id);
                if (freshIds.length > 0) {
                  await postThreadReplies(projectPath, [{ threadId: freshIds[0], body: prRollbackMsg }], taskId, projectName, q, getWindow, extraEnv);
                  await resolveReviewThreads(projectPath, freshIds, taskId, projectName, q, getWindow, extraEnv);
                  sendLog(q, getWindow, taskId, projectName, `Closed ${freshIds.length} review threads (no longer applicable after rollback).`, 'ok');
                }
              } catch (threadErr) {
                sendLog(q, getWindow, taskId, projectName, `Warning: Could not close threads after rollback: ${(threadErr as Error).message}`, 'error');
              }

              // Minimize old review comments as resolved
              await minimizeOldReviews(projectPath, task.pr_number as number, taskId, projectName, q, getWindow, extraEnv);

              const revertedCycle = Math.max(0, task.review_cycle - 1);
              q.updateTask.run(
                task.title, task.description, task.acceptance_criteria, task.images,
                task.model, 'pr_feedback', task.pr_number, revertedCycle,
                task.spec_suggestions, task.plan_summary, task.branch_name, task.pm_work_item_id, task.pm_work_item_url, taskId
              );
            } catch (err) {
              sendLog(q, getWindow, taskId, projectName,
                `Rollback push failed: ${(err as Error).message}. Manual intervention required: git reset --hard ${prevTag} && git push --force-with-lease`,
                'error'
              );
              q.updateTaskStatus.run('pr_feedback', taskId);
            }

            sendPhaseUpdate(getWindow, { taskId, phase: 5, phaseLabel: 'pr_feedback', status: 'completed' });
            activeControllers.delete(taskId);
            return;
          }
        }
      } catch {
        // Previous tag doesn't exist — can't compare, proceed normally
      }
    }

    // Create the annotated rollback tag with thread count AND severity breakdown
    try {
      const tagMessage = `threads:${feedback.threads.length},critical:${severityCounts.critical},high:${severityCounts.high},medium:${severityCounts.medium},low:${severityCounts.low}`;
      await execFileAsync('git', ['tag', '-a', rollbackTag, '-m', tagMessage], projectPath, 5000, false, extraEnv);
      sendLog(q, getWindow, taskId, projectName, `Rollback point created: ${rollbackTag} (${tagMessage})`, 'ok');
    } catch (err) {
      sendLog(q, getWindow, taskId, projectName, `Warning: Could not create rollback tag: ${(err as Error).message}`, 'info');
    }

    // Get list of files modified in this PR for scope enforcement
    let prFiles = '';
    try {
      for (const base of ['main', 'master', 'develop']) {
        try {
          prFiles = (await execFileAsync('git', ['diff', '--name-only', `${base}...HEAD`], projectPath, 10000, false, extraEnv)).trim();
          if (prFiles) break;
        } catch { /* try next */ }
      }
    } catch { /* ignore */ }

    if (totalItems === 0) {
      sendLog(q, getWindow, taskId, projectName, 'No unresolved PR comments found.', 'info');
      q.updateTaskStatus.run('pr_feedback', taskId);
      sendPhaseUpdate(getWindow, { taskId, phase: 5, phaseLabel: 'pr_feedback', status: 'completed' });
      activeControllers.delete(taskId);
      return;
    }

    sendLog(q, getWindow, taskId, projectName, `Found ${feedback.threads.length} unresolved review thread(s). Processing one by one...`, 'info');
    sendNotification('pr_changes_requested', 'PR review feedback received', `${task.title} — ${feedback.threads.length} comment thread(s) to address.`);
    await fireHook('on:pr_changes_requested', { ...hookCtx, phase: 5, phaseLabel: 'pr_fixing', commentCount: feedback.threads.length }, db);

    let accepted = 0;
    let rejected = 0;
    let currentItem = 0;
    const threadSummaries: string[] = [];
    const deferredReplies: { threadId: string; body: string }[] = [];
    const deferredResolveIds: string[] = [];

    // Process general comments first (if any) — batch since they have no thread IDs
    if (feedback.generalComments.trim()) {
      currentItem++;
      sendLog(q, getWindow, taskId, projectName, `[${currentItem}/${totalItems}] Processing general PR comments...`, 'info');
      sendPhaseUpdate(getWindow, {
        taskId, phase: 5, phaseLabel: 'pr_fixing', status: 'in_progress',
        subProgress: { current: currentItem, total: totalItems, label: 'General comments' },
      });

      const prompt = buildSingleThreadPrompt(task, projectDescription, knowledge, criteria, {
        type: 'general',
        content: feedback.generalComments,
      }, undefined, branchHistory, prFiles);
      const { output, exitCode } = await runClaudePhase(projectPath, model, prompt, taskId, q, getWindow, controller, 600000, extraEnv);
      if (exitCode !== 0) {
        sendLog(q, getWindow, taskId, projectName, 'Warning: Failed to process general comments. Continuing...', 'error');
      } else {
        const parsed = parsePhaseOutput(3, output);
        if (parsed.knowledgeEntries && parsed.knowledgeEntries.length > 0) {
          saveKnowledgeEntries(parsed.knowledgeEntries, task.project_id, taskId, q);
        }
        // Track general comments in summary — parse replies and check for changes
        const gcReplies = parsed.threadReplies || [];
        const gcResolved = parsed.resolvedThreadIds || [];
        try {
          const gcDiff = (await execFileAsync('git', ['diff', '--shortstat'], projectPath, 10000, false, extraEnv)).trim();
          if (gcDiff || gcResolved.length > 0) {
            accepted += Math.max(gcResolved.length, gcDiff ? 1 : 0);
          }
          // Count rejected: replies without a matching resolved ID
          const gcRejectedReplies = gcReplies.filter(r => !gcResolved.some(id => r.threadId === id));
          rejected += gcRejectedReplies.length;
        } catch { /* ignore */ }
        // Add each reply as a detailed summary line
        if (gcReplies.length > 0) {
          for (const reply of gcReplies) {
            const isAccepted = gcResolved.some(id => reply.threadId === id);
            const action = isAccepted ? 'accepted' : 'rejected';
            const label = reply.threadId || 'General';
            const body = reply.body.length > 200 ? reply.body.substring(0, 200) + '...' : reply.body;
            threadSummaries.push(`- ${label}: **${action}** — ${body}`);
          }
        } else {
          // No replies parsed — fallback to diff-based summary
          try {
            const gcDiff = (await execFileAsync('git', ['diff', '--shortstat'], projectPath, 10000, false, extraEnv)).trim();
            threadSummaries.push(gcDiff ? `- General comments: applied — ${gcDiff}` : `- General comments: no changes needed`);
          } catch {
            threadSummaries.push(`- General comments: processed`);
          }
        }
      }
    }

    // Process each review thread individually — accumulate actions to prevent regressions
    const previousActions: string[] = [];
    for (let i = 0; i < feedback.threads.length; i++) {
      checkAborted(controller);
      const thread = feedback.threads[i];
      currentItem++;
      const threadLabel = `${thread.file}${thread.line ? ':' + thread.line : ''}`;

      // Step 1: Analyzing & fixing
      sendLog(q, getWindow, taskId, projectName, `[${currentItem}/${totalItems}] Fixing: ${threadLabel}`, 'info');
      sendPhaseUpdate(getWindow, {
        taskId, phase: 5, phaseLabel: 'pr_fixing', status: 'in_progress',
        subProgress: { current: currentItem, total: totalItems, label: threadLabel, step: 'Analizando' },
      });

      const prompt = buildSingleThreadPrompt(task, projectDescription, knowledge, criteria, {
        type: 'thread',
        thread,
      }, previousActions, branchHistory, prFiles);
      const { output, exitCode } = await runClaudePhase(projectPath, model, prompt, taskId, q, getWindow, controller, 600000, extraEnv);

      if (exitCode !== 0) {
        sendLog(q, getWindow, taskId, projectName, `Warning: Failed to fix ${threadLabel}. Continuing...`, 'error');
        continue;
      }

      const parsed = parsePhaseOutput(3, output);

      // Save knowledge immediately
      if (parsed.knowledgeEntries && parsed.knowledgeEntries.length > 0) {
        saveKnowledgeEntries(parsed.knowledgeEntries, task.project_id, taskId, q);
        sendLog(q, getWindow, taskId, projectName, `Knowledge entry captured from thread ${threadLabel}.`, 'ok');
      }

      // Per-thread scope check: if this single fix touched too many files, revert it
      let threadReverted = false;
      try {
        const threadDiff = (await execFileAsync('git', ['diff', '--shortstat'], projectPath, 10000, false, extraEnv)).trim();
        const threadNums = threadDiff.match(/\d+/g)?.map(Number) || [];
        const threadFiles = threadNums[0] || 0;
        const threadLines = (threadNums[1] || 0) + (threadNums[2] || 0);
        const cfgThreadMaxFiles = getSettingValue(q, 'thread_max_files', 5);
        const cfgThreadMaxLines = getSettingValue(q, 'thread_max_lines', 150);
        if (threadFiles > cfgThreadMaxFiles || threadLines > cfgThreadMaxLines) {
          sendLog(q, getWindow, taskId, projectName,
            `Thread ${threadLabel}: EXCESSIVE scope (${threadFiles} files, ${threadLines} lines). Reverting this fix.`,
            'error'
          );
          await execFileAsync('git', ['checkout', '.'], projectPath, 10000, false, extraEnv);
          threadReverted = true;
        }
      } catch { /* ignore — proceed without check */ }

      // Determine accepted/rejected by RESOLVED_THREAD presence
      const wasAccepted = !threadReverted && (parsed.resolvedThreadIds || []).length > 0;
      if (wasAccepted) accepted++;
      else rejected++;

      checkAborted(controller);

      // Step 2: Collect replies and thread IDs — defer posting until user approves push
      const threadReplyToPost = threadReverted
        ? [{ threadId: thread.id, body: 'Auto-reverted: the fix exceeded scope limits (too many files/lines changed for a single comment). Will address manually.' }]
        : parsed.threadReplies;
      if (threadReplyToPost?.length) {
        deferredReplies.push(...threadReplyToPost);
      }

      // Step 3: Collect thread IDs to resolve — defer until user approves push
      if (thread.id && !threadReverted) {
        const resolvedIds = parsed.resolvedThreadIds || [];
        const repliedIds = (threadReplyToPost || []).map((r) => r.threadId).filter((id) => id);
        const idsToResolve = [...new Set([...resolvedIds, ...repliedIds, thread.id])];
        deferredResolveIds.push(...idsToResolve);
      }

      checkAborted(controller);

      // Step 4: Committing
      sendPhaseUpdate(getWindow, {
        taskId, phase: 5, phaseLabel: 'pr_fixing', status: 'in_progress',
        subProgress: { current: currentItem, total: totalItems, label: threadLabel, step: 'Commit' },
      });
      const action = threadReverted ? 'reverted' : (wasAccepted ? 'accepted' : 'rejected');
      const replyText = threadReplyToPost?.[0]?.body || '';
      const actionSummary = replyText.length > 120 ? replyText.substring(0, 120) + '...' : replyText;
      threadSummaries.push(`- ${threadLabel}: ${action}${actionSummary ? ' — ' + actionSummary : ''}`);
      const commitMsg = `fix(pr-review): ${threadLabel} [${action}]`;
      const commitPrompt = `Run these commands using your Bash tool. Do NOT modify any files:
1. git add -A
2. git diff --cached --stat
3. If there are staged changes: git commit -m "${commitMsg}"
4. If no changes: output "No changes to commit"
Do NOT push yet.`;
      await runClaudePhase(projectPath, model, commitPrompt, taskId, q, getWindow, controller, 60000, extraEnv);

      // Accumulate action for context in subsequent threads
      previousActions.push(`[${action.toUpperCase()}] ${threadLabel}: ${replyText.length > 200 ? replyText.substring(0, 200) + '...' : replyText}`);

      sendLog(q, getWindow, taskId, projectName, `[${currentItem}/${totalItems}] Done: ${threadLabel} (${action})`, 'ok');
    }

    checkAborted(controller);

    // ── Post-fix validation gate (native tests + fix loop) ─────────────────
    sendLog(q, getWindow, taskId, projectName, '── Post-fix validation gate ──', 'info');
    sendPhaseUpdate(getWindow, {
      taskId, phase: 5, phaseLabel: 'pr_fixing', status: 'in_progress',
      subProgress: { current: totalItems, total: totalItems, label: 'Validation', step: 'Running tests' },
    });

    // 1. Check diff size — compare against rollback tag
    let diffExploded = false;
    try {
      const diffStat = (await execFileAsync('git', ['diff', '--shortstat', rollbackTag], projectPath, 10000, false, extraEnv)).trim();
      const nums = diffStat.match(/\d+/g)?.map(Number) || [];
      const filesChanged = nums[0] || 0;
      const totalLines = (nums[1] || 0) + (nums[2] || 0);
      sendLog(q, getWindow, taskId, projectName, `Post-fix validation: ${filesChanged} files changed, ${totalLines} lines modified.`, 'info');

      const commentCount = feedback.threads.length;
      const cfgLinesPerComment = getSettingValue(q, 'postfix_lines_per_comment', 50);
      const cfgFilesPerComment = getSettingValue(q, 'postfix_files_per_comment', 3);
      const maxLines = Math.max(commentCount * cfgLinesPerComment, cfgLinesPerComment * 2);
      const maxFiles = Math.max(commentCount * cfgFilesPerComment, cfgFilesPerComment * 2);
      if (totalLines > maxLines || filesChanged > maxFiles) {
        diffExploded = true;
        sendLog(q, getWindow, taskId, projectName,
          `Post-fix validation: EXCESSIVE changes detected (${totalLines} lines / ${filesChanged} files for ${commentCount} comments). Threshold: ${maxLines} lines / ${maxFiles} files.`,
          'error'
        );
      }
    } catch {
      sendLog(q, getWindow, taskId, projectName, 'Post-fix validation: Could not check diff size.', 'info');
    }

    if (diffExploded) {
      sendLog(q, getWindow, taskId, projectName, `ROLLING BACK to ${rollbackTag} — fixes caused more harm than good.`, 'error');
      try {
        await execFileAsync('git', ['reset', '--hard', rollbackTag], projectPath, 15000, false, extraEnv);
        sendLog(q, getWindow, taskId, projectName, `Rollback successful. Branch restored to pre-fix state.`, 'ok');
      } catch (err) {
        sendLog(q, getWindow, taskId, projectName, `Rollback failed: ${(err as Error).message}. Manual intervention needed.`, 'error');
      }
      q.updateTaskStatus.run('pr_feedback', taskId);
      sendPhaseUpdate(getWindow, { taskId, phase: 5, phaseLabel: 'pr_feedback', status: 'completed' });
      activeControllers.delete(taskId);
      return;
    }

    // 2. Run native tests + fix loop
    const proj = q.getProject.get(task.project_id) as { test_command?: string } | undefined;
    const testCmd = (proj as Record<string, unknown>)?.test_command as string || '';
    const testTimeoutMin = getSettingValue(q, 'test_timeout_min', 5);
    const testTimeoutMs = testTimeoutMin * 60000;
    const maxTestFixRetries = getSettingValue(q, 'test_fix_retries', 3);

    let testStatus: 'pass' | 'timeout' | 'fail' | 'no_command' | 'fixed' = 'pass';
    let testFixAttempts = 0;

    const testResult = await runNativeTests(projectPath, testCmd, taskId, projectName, q, getWindow, testTimeoutMs);

    if (testResult.output === 'No test command configured or detected — skipping native tests.') {
      testStatus = 'no_command';
    } else if (testResult.timedOut) {
      testStatus = 'timeout';
      sendLog(q, getWindow, taskId, projectName, `Post-fix validation: Tests timed out. Proceeding with caution.`, 'info');
    } else if (!testResult.pass) {
      // Tests failed — enter fix loop
      testStatus = 'fail';
      let fixed = false;
      let attempt = 0;

      while (!fixed && attempt < maxTestFixRetries) {
        checkAborted(controller);
        attempt++;
        testFixAttempts = attempt;
        sendLog(q, getWindow, taskId, projectName, `Post-fix validation: Tests failed. Claude attempting fix (${attempt}/${maxTestFixRetries})...`, 'info');
        sendPhaseUpdate(getWindow, {
          taskId, phase: 5, phaseLabel: 'pr_fixing', status: 'in_progress',
          subProgress: { current: totalItems, total: totalItems, label: 'Fixing tests', step: `Attempt ${attempt}/${maxTestFixRetries}` },
        });

        const fixPrompt = `Tests failed. Fix ONLY the failing tests — do NOT change application logic.
Test command: ${testCmd || detectTestCommand(projectPath) || 'npm test'}
Test output (last 3000 chars):
${testResult.output}

Fix the test failures and ensure all tests pass. Only modify test files or the minimal code needed to fix the failures.`;

        await runClaudePhase(projectPath, model, fixPrompt, taskId, q, getWindow, controller, 600000, extraEnv);

        // Re-run native tests
        const retryResult = await runNativeTests(projectPath, testCmd, taskId, projectName, q, getWindow, testTimeoutMs);
        if (retryResult.pass || retryResult.timedOut) {
          fixed = true;
          testStatus = retryResult.timedOut ? 'timeout' : 'fixed';
          if (retryResult.timedOut) {
            sendLog(q, getWindow, taskId, projectName, 'Post-fix validation: Tests timed out after fix. Proceeding with caution.', 'info');
          }
        } else {
          // Update output for next attempt
          testResult.output = retryResult.output;
        }
      }

      if (!fixed) {
        // Max retries exhausted — pause in test_fixing state
        sendLog(q, getWindow, taskId, projectName, `Post-fix validation: Tests still failing after ${maxTestFixRetries} fix attempts. Pausing for manual intervention.`, 'error');
        sendNotification('tests_failing', 'Tests still failing', `${task.title} — After ${maxTestFixRetries} fix attempts, tests still failing. Manual intervention needed.`);
        q.updateTaskStatus.run('test_fixing', taskId);
        sendPhaseUpdate(getWindow, { taskId, phase: 5, phaseLabel: 'test_fixing', status: 'paused' });

        // Wait for user to click "Fix Tests"
        await waitForFixTests(taskId, controller);

        // User clicked Fix Tests — re-run the loop
        checkAborted(controller);
        sendLog(q, getWindow, taskId, projectName, 'Fix Tests requested by user. Re-running test fix loop...', 'info');
        q.updateTaskStatus.run('pr_fixing', taskId);
        sendPhaseUpdate(getWindow, {
          taskId, phase: 5, phaseLabel: 'pr_fixing', status: 'in_progress',
          subProgress: { current: totalItems, total: totalItems, label: 'Fixing tests', step: 'Retrying' },
        });

        let fixedAfterRetry = false;
        let retryAttempt = 0;
        while (!fixedAfterRetry && retryAttempt < maxTestFixRetries) {
          checkAborted(controller);
          retryAttempt++;

          const latestTestResult = await runNativeTests(projectPath, testCmd, taskId, projectName, q, getWindow, testTimeoutMs);
          if (latestTestResult.pass || latestTestResult.timedOut) {
            fixedAfterRetry = true;
            break;
          }

          sendLog(q, getWindow, taskId, projectName, `Fix Tests: Claude attempting fix (${retryAttempt}/${maxTestFixRetries})...`, 'info');
          const retryFixPrompt = `Tests failed. Fix ONLY the failing tests — do NOT change application logic.
Test command: ${testCmd || detectTestCommand(projectPath) || 'npm test'}
Test output (last 3000 chars):
${latestTestResult.output}

Fix the test failures and ensure all tests pass.`;
          await runClaudePhase(projectPath, model, retryFixPrompt, taskId, q, getWindow, controller, 600000, extraEnv);

          const postFixResult = await runNativeTests(projectPath, testCmd, taskId, projectName, q, getWindow, testTimeoutMs);
          if (postFixResult.pass || postFixResult.timedOut) {
            fixedAfterRetry = true;
          }
        }

        if (!fixedAfterRetry) {
          sendLog(q, getWindow, taskId, projectName, `Fix Tests: Still failing after ${maxTestFixRetries} attempts. Pausing again.`, 'error');
          q.updateTaskStatus.run('test_fixing', taskId);
          sendPhaseUpdate(getWindow, { taskId, phase: 5, phaseLabel: 'test_fixing', status: 'paused' });
          activeControllers.delete(taskId);
          return;
        }
      }
    }

    sendLog(q, getWindow, taskId, projectName, 'Post-fix validation: PASSED. Proceeding to push review.', 'ok');

    checkAborted(controller);

    // ── Push Review Gate ──────────────────────────────────────────────────
    // Build summary for user review
    const testStatusLabels: Record<string, string> = {
      pass: 'All tests passing',
      fixed: `Tests fixed by Claude (${testFixAttempts} attempt${testFixAttempts > 1 ? 's' : ''})`,
      timeout: 'Tests timed out (proceeded with caution)',
      no_command: 'No test command configured — tests skipped',
      fail: 'Tests failing',
    };
    const testIcon = testStatus === 'pass' ? '✅' : testStatus === 'fixed' ? '🔧' : testStatus === 'timeout' ? '⏱️' : testStatus === 'no_command' ? '⚠️' : '❌';
    const pushSummary = [
      `## Fetch & Fix Summary (Cycle ${task.review_cycle + 1})`,
      ``,
      `**${accepted} accepted** | **${rejected} rejected**`,
      ``,
      `### Changes:`,
      ...threadSummaries.map(s => s),
      ``,
      `### Tests:`,
      `${testIcon} ${testStatusLabels[testStatus]}`,
    ].join('\n');

    // Pause and wait for user approval
    sendNotification('push_review', 'Ready to push fixes', `${task.title} — ${accepted} accepted, ${rejected} rejected. Review before pushing.`);
    q.updateTaskStatus.run('push_review', taskId);
    // Store summary in plan_summary field temporarily for UI display
    q.updateTask.run(
      task.title, task.description, task.acceptance_criteria, task.images,
      task.model, 'push_review', task.pr_number, task.review_cycle,
      task.spec_suggestions, pushSummary, task.branch_name, task.pm_work_item_id, task.pm_work_item_url, taskId
    );
    sendPhaseUpdate(getWindow, {
      taskId, phase: 5, phaseLabel: 'push_review', status: 'in_progress',
      subProgress: { current: totalItems, total: totalItems, label: 'Review', step: 'Waiting for approval' },
    });
    sendLog(q, getWindow, taskId, projectName, 'Push review: waiting for user approval before pushing...', 'info');

    let pushApproved = false;
    while (!pushApproved) {
      checkAborted(controller);
      const decision = await waitForPushApproval(taskId, controller);

      if (decision.action === 'approve') {
        pushApproved = true;
        await fireHook('on:pr_approved', { ...hookCtx, phase: 5, phaseLabel: 'pr_feedback', prNumber: task.pr_number || undefined }, db);
      } else if (decision.action === 'reject') {
        sendLog(q, getWindow, taskId, projectName, 'Push rejected by user. Discarding local changes.', 'info');
        try {
          await execFileAsync('git', ['checkout', '.'], projectPath, 10000, false, extraEnv);
          await execFileAsync('git', ['clean', '-fd'], projectPath, 10000, false, extraEnv);
        } catch { /* ignore */ }
        q.updateTaskStatus.run('pr_feedback', taskId);
        sendPhaseUpdate(getWindow, { taskId, phase: 5, phaseLabel: 'pr_feedback', status: 'completed' });
        activeControllers.delete(taskId);
        return;
      } else if (decision.action === 'revise' && decision.prompt) {
        sendLog(q, getWindow, taskId, projectName, `Revision requested: ${decision.prompt}`, 'info');
        q.updateTaskStatus.run('pr_fixing', taskId);
        sendPhaseUpdate(getWindow, {
          taskId, phase: 5, phaseLabel: 'pr_fixing', status: 'in_progress',
          subProgress: { current: totalItems, total: totalItems, label: 'Revision', step: 'Applying revision' },
        });
        const revisionPrompt = `The user reviewed the PR fixes before pushing and requested the following revision:\n\n${decision.prompt}\n\nApply the requested changes. Only modify files that are part of this PR.`;
        await runClaudePhase(projectPath, model, revisionPrompt, taskId, q, getWindow, controller, 600000);

        // Update summary and pause again
        q.updateTaskStatus.run('push_review', taskId);
        sendPhaseUpdate(getWindow, {
          taskId, phase: 5, phaseLabel: 'push_review', status: 'in_progress',
          subProgress: { current: totalItems, total: totalItems, label: 'Review', step: 'Waiting for approval' },
        });
        sendLog(q, getWindow, taskId, projectName, 'Revision applied. Waiting for approval again...', 'info');
      }
    }

    checkAborted(controller);

    // ── Post replies and resolve threads (deferred until user approved) ──
    if (deferredReplies.length > 0) {
      sendLog(q, getWindow, taskId, projectName, `Posting ${deferredReplies.length} reply(s) on PR threads...`, 'info');
      await postThreadReplies(projectPath, deferredReplies, taskId, projectName, q, getWindow, extraEnv);
    }
    if (deferredResolveIds.length > 0) {
      sendLog(q, getWindow, taskId, projectName, `Resolving ${deferredResolveIds.length} thread(s) on GitHub...`, 'info');
      const uniqueIds = [...new Set(deferredResolveIds)];
      await resolveReviewThreads(projectPath, uniqueIds, taskId, projectName, q, getWindow, extraEnv);
    }

    // Squash all per-thread commits into one clean commit, then push
    sendLog(q, getWindow, taskId, projectName, 'Squashing commits and pushing...', 'info');
    sendPhaseUpdate(getWindow, {
      taskId, phase: 5, phaseLabel: 'pr_fixing', status: 'in_progress',
      subProgress: { current: totalItems, total: totalItems, label: 'Push', step: 'Squash & Push' },
    });
    const newCycleNum = task.review_cycle + 1;
    const squashBody = threadSummaries.join('\\n');
    const squashMsg = `fix: address PR review feedback (cycle ${newCycleNum})\\n\\n${squashBody}`;
    const squashAndPushPrompt = `Run these commands using your Bash tool. Do NOT modify any files:
1. Count how many commits are ahead of origin: git rev-list --count origin/${task.branch_name}..HEAD
2. If count > 1: git reset --soft origin/${task.branch_name} && git commit -m "${squashMsg}"
3. If count is 1: git commit --amend -m "${squashMsg}"
4. If count is 0: output "No commits to squash"
5. git push --force-with-lease`;
    await runClaudePhase(projectPath, model, squashAndPushPrompt, taskId, q, getWindow, controller, 120000, extraEnv);

    // Minimize current cycle reviews + delete old cycle reviews
    await minimizeOldReviews(projectPath, task.pr_number as number, taskId, projectName, q, getWindow, extraEnv);
    await cleanupOldPRComments(projectPath, task.pr_number as number, taskId, projectName, q, getWindow, 2, extraEnv);

    // Increment review cycle
    q.updateTask.run(
      task.title, task.description, task.acceptance_criteria, task.images,
      task.model, 'pr_feedback', task.pr_number, newCycleNum,
      task.spec_suggestions, task.plan_summary, task.branch_name, task.pm_work_item_id, task.pm_work_item_url, taskId
    );

    sendPhaseUpdate(getWindow, { taskId, phase: 5, phaseLabel: 'pr_feedback', status: 'completed', reviewLoop: newCycleNum });
    sendLog(q, getWindow, taskId, projectName,
      `Fetch & Fix complete (cycle ${newCycleNum}). ${accepted} accepted, ${rejected} rejected with justification. Waiting for human review.`,
      'ok'
    );
    sendNotification('pr_fix_pushed', `Fixes pushed (cycle ${newCycleNum})`, `${task.title} — ${accepted} accepted, ${rejected} rejected. Awaiting next review.`);
    await fireHook('on:pr_fix_pushed', { ...hookCtx, phase: 5, phaseLabel: 'pr_feedback', prNumber: task.pr_number || undefined, reviewLoop: newCycleNum }, db);
    activeControllers.delete(taskId);

  } catch (err) {
    activeControllers.delete(taskId);
    if ((err as Error).name === 'AbortError') return;
    q.updateTaskStatus.run('failed', taskId);
    sendLog(q, getWindow, taskId, '', `Fetch & Fix failed: ${(err as Error).message}`, 'error');
    sendPhaseUpdate(getWindow, { taskId, phase: 5, phaseLabel: 'pr_fixing', status: 'failed' });
  }
}

// ── Standalone Push (when approve/reject happens without active resolver) ────

export async function runFetchAndFixPushOnly(
  taskId: string,
  q: Queries,
  _db: Database.Database,
  getWindow: GetWindow
) {
  const controller = new AbortController();
  activeControllers.set(taskId, controller);

  try {
    const task = q.getTask.get(taskId) as TaskRow | undefined;
    if (!task) throw new Error(`Task ${taskId} not found`);

    const projectPath = task.project_path;
    const projectName = task.project_name;
    const model = task.model;

    // Resolve code hosting env vars for subprocess calls
    const extraEnv = resolveEnvVars(task.project_id, _db);

    // Resolve all unresolved threads before pushing (deferred data was lost)
    sendPhaseUpdate(getWindow, {
      taskId, phase: 5, phaseLabel: 'pr_fixing', status: 'in_progress',
      subProgress: { current: 1, total: 3, label: 'Threads', step: 'Resolving threads' },
    });
    try {
      const feedback = await fetchUnresolvedPrFeedback(projectPath, task.pr_number as number, taskId, projectName, q, getWindow, extraEnv);
      if (feedback.threads.length > 0) {
        const threadIds = feedback.threads.map(t => t.id);
        sendLog(q, getWindow, taskId, projectName, `Resolving ${threadIds.length} unresolved thread(s) on GitHub...`, 'info');
        await resolveReviewThreads(projectPath, threadIds, taskId, projectName, q, getWindow, extraEnv);
      } else {
        sendLog(q, getWindow, taskId, projectName, 'No unresolved threads to resolve.', 'info');
      }
    } catch (err) {
      sendLog(q, getWindow, taskId, projectName, `Warning: Could not resolve threads: ${(err as Error).message}`, 'error');
    }

    // Squash + push
    sendPhaseUpdate(getWindow, {
      taskId, phase: 5, phaseLabel: 'pr_fixing', status: 'in_progress',
      subProgress: { current: 2, total: 3, label: 'Push', step: 'Squash & Push' },
    });

    const newCycleNum = task.review_cycle + 1;
    const squashMsg = `fix: address PR review feedback (cycle ${newCycleNum})`;
    const squashAndPushPrompt = `Run these commands using your Bash tool. Do NOT modify any files:
1. Count how many commits are ahead of origin: git rev-list --count origin/${task.branch_name}..HEAD
2. If count > 1: git reset --soft origin/${task.branch_name} && git commit -m "${squashMsg}"
3. If count is 1: git commit --amend -m "${squashMsg}"
4. If count is 0: git add -A && git commit -m "${squashMsg}" (stage any uncommitted changes)
5. git push --force-with-lease`;
    await runClaudePhase(projectPath, model, squashAndPushPrompt, taskId, q, getWindow, controller, 120000, extraEnv);

    // Cleanup old reviews
    sendPhaseUpdate(getWindow, {
      taskId, phase: 5, phaseLabel: 'pr_fixing', status: 'in_progress',
      subProgress: { current: 3, total: 3, label: 'Cleanup', step: 'Minimizing old reviews' },
    });
    await minimizeOldReviews(projectPath, task.pr_number as number, taskId, projectName, q, getWindow, extraEnv);
    await cleanupOldPRComments(projectPath, task.pr_number as number, taskId, projectName, q, getWindow, 2, extraEnv);

    q.updateTask.run(
      task.title, task.description, task.acceptance_criteria, task.images,
      task.model, 'pr_feedback', task.pr_number, newCycleNum,
      task.spec_suggestions, task.plan_summary, task.branch_name, task.pm_work_item_id, task.pm_work_item_url, taskId
    );

    sendPhaseUpdate(getWindow, { taskId, phase: 5, phaseLabel: 'pr_feedback', status: 'completed', reviewLoop: newCycleNum });
    sendLog(q, getWindow, taskId, projectName, `Push complete (cycle ${newCycleNum}). Waiting for human review.`, 'ok');
    activeControllers.delete(taskId);
  } catch (err) {
    activeControllers.delete(taskId);
    if ((err as Error).name === 'AbortError') return;
    q.updateTaskStatus.run('pr_feedback', taskId);
    sendLog(q, getWindow, taskId, '', `Push failed: ${(err as Error).message}`, 'error');
    sendPhaseUpdate(getWindow, { taskId, phase: 5, phaseLabel: 'pr_feedback', status: 'completed' });
  }
}
