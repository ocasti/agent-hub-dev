import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTime, formatDateTime } from '../lib/format';
import type { Task, Project, Log, ActiveAgent, CriterionStatus, Subtask, PluginCriterion, InjectedAction } from '../lib/types';
import { CORE_SKILLS } from '../lib/skills';
import { executePluginOperation, completeSubtask, completeCriterion, refreshSubtasks, getInjectedActions } from '../lib/ipc';
import Badge from './ui/Badge';
import ProgressBar from './ui/ProgressBar';
import SkillTag from './ui/SkillTag';
import { IconEdit, IconPlay, IconStop, IconRuler, IconDownload, IconCircleCheck, IconImage, IconRetry, IconChevronDown, IconX, IconRefresh, IconClipboard } from './ui/Icons';

interface TaskDetailProps {
  task: Task;
  project?: Project;
  agent?: ActiveAgent;
  logs: Log[];
  onBack: () => void;
  onEdit: () => void;
  onStart: () => void;
  onStop: () => void;
  onRefineSpec: () => void;
  onContinueSpec: () => void;
  onApprovePlan: () => void;
  onReplan: () => void;
  onFetchAndFix: () => void;
  onApprove: () => void;
  onSyncRemote: () => void;
  onSyncParent: () => void;
  onApprovePush: () => void;
  onRejectPush: () => void;
  onRevisePush: (prompt: string) => void;
  onFixTests: () => void;
  onDelete: () => void;
}

export default function TaskDetail({
  task, project, agent, logs, onBack, onEdit, onStart, onStop,
  onRefineSpec, onContinueSpec, onApprovePlan, onReplan, onFetchAndFix, onApprove,
  onSyncRemote, onSyncParent,
  onApprovePush, onRejectPush, onRevisePush, onFixTests, onDelete,
}: TaskDetailProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const [revisionPrompt, setRevisionPrompt] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ spec: true, criteria: true });
  const toggle = (key: string) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  const [activityHeight, setActivityHeight] = useState(160);
  const [refreshingPmData, setRefreshingPmData] = useState(false);
  const [localSubtasks, setLocalSubtasks] = useState<{ pluginId: string; id: string; description: string; completed: boolean }[] | null>(null);
  const [localCriteria, setLocalCriteria] = useState<{ pluginId: string; id: string; description: string; completed: boolean }[] | null>(null);
  const [pmStatus, setPmStatus] = useState<string | null>(null);
  const [pmUrl, setPmUrl] = useState<string | null>(task.pmWorkItemUrl || null);
  const [injectedActions, setInjectedActions] = useState<InjectedAction[]>([]);
  const [actionModalPrompt, setActionModalPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  // Fetch PM status when task has a PM work item linked
  useEffect(() => {
    if (!task.pmWorkItemId || !project?.pluginPm) return;
    setPmStatus(null);
    // Use listMyWork (which returns status_name) and find the item by ID
    executePluginOperation(project.pluginPm, 'listMyWork', { __raw: 'true' })
      .then((raw) => {
        // listMyWork returns an array of work items
        const items = Array.isArray(raw) ? raw : [];
        const item = items.find((i: Record<string, unknown>) =>
          String(i.id) === task.pmWorkItemId
        ) as Record<string, unknown> | undefined;
        if (item) {
          const status = item.status_name || item.statusName || item.status || item.state;
          if (status) setPmStatus(String(status));
          const url = item.url || item.link || item.web_url;
          if (url && !pmUrl) setPmUrl(String(url));
        }
      })
      .catch(() => { /* PM status fetch failed — non-critical */ });
  }, [task.pmWorkItemId, task.status, project?.pluginPm]);

  // Fetch injected actions from plugins when task status changes
  useEffect(() => {
    getInjectedActions(task.id)
      .then(setInjectedActions)
      .catch(() => setInjectedActions([]));
  }, [task.id, task.status]);

  const handleActionClick = (action: InjectedAction) => {
    if (!action.prompt) return;
    if (action.mode === 'modal') {
      setActionModalPrompt(action.prompt);
    } else {
      navigator.clipboard.writeText(action.prompt).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = activityHeight;
    dragRef.current = { startY, startH };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      setActivityHeight(Math.max(80, Math.min(600, dragRef.current.startH + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [activityHeight]);

  const isEditable = ['queued', 'pr_feedback', 'completed', 'spec_feedback', 'test_fixing'].includes(task.status);
  const isRunning = !['queued', 'completed', 'failed', 'pr_feedback', 'spec_feedback', 'plan_review', 'push_review', 'test_fixing'].includes(task.status);
  const taskLogs = logs.filter((l) => l.projectName === task.projectName).slice(0, 30);

  return (
    <div className="space-y-5 w-full">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('header.title')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('header.subtitle')}</p>
      </div>
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white font-bold text-sm">
                {task.projectName?.[0]?.toUpperCase()}
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{task.title}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-400">{task.projectName}</span>
                  <span className="text-xs text-gray-300">·</span>
                  <span className="text-xs text-gray-400">{t('detail.createdAt', { date: formatDateTime(task.createdAt) })}</span>
                  {task.reviewCycle > 0 && (
                    <>
                      <span className="text-xs text-gray-300">·</span>
                      <span className="text-xs text-pink-500">{t('detail.cycle', { cycle: task.reviewCycle })}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-1.5 py-0.5 rounded ${task.model === 'opus' ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                {task.model}
              </span>
              {task.prNumber && (
                <span className="text-xs bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded font-mono">PR #{task.prNumber}</span>
              )}
              {task.pmWorkItemId && (
                pmUrl ? (
                  <a
                    href={pmUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                    title="Open in PM tool"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                    PM{pmStatus ? `: ${pmStatus}` : ''}
                  </a>
                ) : (
                  <span className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded">
                    PM{pmStatus ? `: ${pmStatus}` : ''}
                  </span>
                )
              )}
              <Badge status={task.status} />
            </div>
          </div>
        </div>

        {/* Actions bar */}
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 flex items-center gap-2">
          <button onClick={onBack} className="text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:border-gray-400 text-gray-700 dark:text-gray-300 font-medium px-3 py-1.5 rounded-lg">
            &larr; {t('common:button.back')}
          </button>
          <button onClick={onEdit} className="text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:border-indigo-300 text-gray-700 dark:text-gray-300 font-medium px-3 py-1.5 rounded-lg">
            <IconEdit className="w-3 h-3" /> {t('common:button.edit')}
          </button>
          {task.status === 'queued' && !agent && (task.lastPhase ?? -1) <= -1 && (
            <button onClick={onStart} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1.5 rounded-lg">
              <IconPlay className="w-3 h-3" /> {t('button.start')}
            </button>
          )}
          {task.status === 'queued' && !agent && (task.lastPhase ?? -1) > -1 && (
            <button onClick={onStart} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
              <IconPlay className="w-3 h-3" /> {t('button.resume')}
            </button>
          )}
          {agent && (
            <button onClick={onStop} className="text-xs bg-red-600 hover:bg-red-700 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
              <IconStop className="w-3 h-3" /> {t('button.stop')}
            </button>
          )}
          {task.status === 'spec_feedback' && (
            <>
              <button onClick={onRefineSpec} className="text-xs bg-cyan-600 hover:bg-cyan-700 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
                <IconEdit className="w-3 h-3" /> {t('button.refineSpec')}
              </button>
              <button onClick={onContinueSpec} className="text-xs bg-gray-500 hover:bg-gray-600 text-white font-medium px-3 py-1.5 rounded-lg">
                {t('button.continueAsIs')} &rarr;
              </button>
            </>
          )}
          {task.status === 'plan_review' && (
            <>
              <button onClick={onApprovePlan} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
                <IconCircleCheck className="w-3 h-3" /> {t('button.approvePlan')}
              </button>
              <button onClick={onReplan} className="text-xs bg-gray-500 hover:bg-gray-600 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
                <IconEdit className="w-3 h-3" /> {t('button.replan')}
              </button>
            </>
          )}
          {task.status === 'push_review' && (
            <>
              <button onClick={onApprovePush} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
                <IconCircleCheck className="w-3 h-3" /> {t('button.approvePush', 'Approve Push')}
              </button>
              <button onClick={onRejectPush} className="text-xs bg-red-600 hover:bg-red-700 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
                <IconX className="w-3 h-3" /> {t('button.rejectPush', 'Reject')}
              </button>
            </>
          )}
          {task.status === 'test_fixing' && (
            <button onClick={onFixTests} className="text-xs bg-red-600 hover:bg-red-700 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
              <IconRetry className="w-3 h-3" /> {t('button.fixTests')}
            </button>
          )}
          {task.status === 'pr_feedback' && (
            <>
              <button onClick={onFetchAndFix} className="text-xs bg-orange-500 hover:bg-orange-600 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
                <IconDownload className="w-3 h-3" /> {t('button.fetchAndFix')}
              </button>
              <button onClick={onSyncRemote} className="text-xs bg-sky-500 hover:bg-sky-600 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
                <IconRefresh className="w-3 h-3" /> {t('button.syncRemote')}
              </button>
              <button onClick={onSyncParent} className="text-xs bg-violet-500 hover:bg-violet-600 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
                <IconRefresh className="w-3 h-3" /> {t('button.syncParent')}
              </button>
              <button onClick={onApprove} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
                <IconCircleCheck className="w-3 h-3" /> {t('button.approve')}
              </button>
              <button
                onClick={() => {
                  const criteria = task.acceptanceCriteria || [];
                  const criteriaText = criteria.length > 0
                    ? criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
                    : 'No specific acceptance criteria defined.';
                  setActionModalPrompt(
`You are a QA tester. Your goal is to validate the acceptance criteria for the feature: "${task.title}".

## Setup
Switch to the worktree with branch: ${task.branchName || 'unknown'}

Start the development environment and navigate to the application.

## Acceptance Criteria to Validate:
${criteriaText}

## Instructions:
- Test each criterion one by one, in order
- For each one, describe: what you did, what you observed, and whether it PASSES or FAILS
- Take screenshots of the results when possible
- If a criterion fails, describe the expected vs actual behavior clearly
- Report a final summary: how many passed, how many failed, and any blocking issues found`
                  );
                }}
                className="text-xs bg-teal-600 hover:bg-teal-700 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1"
              >
                <IconClipboard className="w-3 h-3" /> {t('button.qaPrompt', 'QA Prompt')}
              </button>
            </>
          )}
          {injectedActions.length > 0 && injectedActions.map((action) => (
            <button
              key={`${action.pluginId}-${action.actionId}`}
              onClick={() => handleActionClick(action)}
              className="text-xs bg-violet-600 hover:bg-violet-700 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1"
              title={action.prompt ? (copied ? t('detail.copied', 'Copied!') : action.label) : action.label}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              {copied ? t('detail.copied', 'Copied!') : action.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {task.status === 'failed' && (
              <button onClick={onStart} className="text-xs bg-amber-600 hover:bg-amber-700 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
                <IconRetry className="w-3 h-3" /> {t('button.retry')}
              </button>
            )}
            {(task.status === 'queued' || task.status === 'failed') && (
              <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600 font-medium px-3 py-1.5">
                {t('common:button.delete')}
              </button>
            )}
          </div>
        </div>

        {/* Progress if running */}
        {(isRunning || agent) && (
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <ProgressBar agent={agent} />
          </div>
        )}

        {/* Spec Review Suggestions */}
        {task.status === 'spec_feedback' && task.specSuggestions && task.specSuggestions.length > 0 && (
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-cyan-50/50 dark:bg-cyan-900/20">
            <h4 className="text-xs font-semibold text-cyan-700 dark:text-cyan-400 uppercase tracking-wider mb-2 flex items-center gap-1"><IconRuler className="w-3.5 h-3.5" /> {t('detail.specSuggestionsTitle')}</h4>
            <div className="space-y-2">
              {task.specSuggestions.map((s, i) => (
                <div key={i} className="flex items-start gap-2 bg-white dark:bg-gray-800 border border-cyan-200 dark:border-cyan-800 rounded-lg p-2.5">
                  <span className="text-cyan-500 text-sm mt-0.5">-&gt;</span>
                  <span className="text-sm text-cyan-800">{s}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-cyan-600 mt-2">{t('detail.specSuggestionsHelp')}</p>
          </div>
        )}

        {/* Plan Review Summary */}
        {task.status === 'plan_review' && task.planSummary && (
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-sky-50/50 dark:bg-sky-900/20">
            <h4 className="text-xs font-semibold text-sky-700 dark:text-sky-400 uppercase tracking-wider mb-2 flex items-center gap-1"><IconRuler className="w-3.5 h-3.5" /> {t('detail.planReviewTitle')}</h4>
            <div className="bg-white dark:bg-gray-800 border border-sky-200 dark:border-sky-800 rounded-lg p-3 max-h-64 overflow-y-auto">
              <pre className="text-sm text-sky-800 dark:text-sky-300 whitespace-pre-wrap font-mono">{task.planSummary}</pre>
            </div>
            <p className="text-xs text-sky-600 dark:text-sky-500 mt-2">{t('detail.planReviewHelp')}</p>
          </div>
        )}

        {/* Push Review Summary */}
        {task.status === 'push_review' && task.planSummary && (
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-amber-50/50 dark:bg-amber-900/20">
            <h4 className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-2">Push Review</h4>
            <div className="bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-800 rounded-lg p-3 max-h-64 overflow-y-auto">
              <pre className="text-sm text-amber-800 dark:text-amber-300 whitespace-pre-wrap font-mono">{task.planSummary}</pre>
            </div>
            <div className="mt-3">
              <textarea
                className="w-full p-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400"
                placeholder={t('detail.revisionPromptPlaceholder', 'Describe improvements needed...')}
                rows={3}
                value={revisionPrompt}
                onChange={(e) => setRevisionPrompt(e.target.value)}
              />
              <button
                onClick={() => { onRevisePush(revisionPrompt); setRevisionPrompt(''); }}
                disabled={!revisionPrompt.trim()}
                className="mt-2 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium px-3 py-1.5 rounded-lg"
              >
                {t('button.requestRevision', 'Request Revision')}
              </button>
            </div>
          </div>
        )}

        {/* Skills */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <button onClick={() => toggle('skills')} className="flex items-center gap-1 w-full text-left">
            <IconChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${collapsed.skills ? '-rotate-90' : ''}`} />
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('detail.projectSkills')}</h4>
          </button>
          {!collapsed.skills && (
            <div className="flex flex-wrap gap-1 mt-2">
              {CORE_SKILLS.map((s) => <SkillTag key={s.id} id={s.id} locked size="xs" />)}
              {project?.optionalSkills?.map((s) => <SkillTag key={s} id={s} size="xs" />)}
            </div>
          )}
        </div>

        {/* Spec */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <button onClick={() => toggle('spec')} className="flex items-center gap-1 w-full text-left">
            <IconChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${collapsed.spec ? '-rotate-90' : ''}`} />
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('detail.specTitle')}</h4>
          </button>
          {!collapsed.spec && (
            <div className="mt-2">
              {task.description ? (
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono bg-gray-50 dark:bg-gray-900 rounded-lg p-3">{task.description}</p>
              ) : (
                <p className="text-xs text-gray-300 dark:text-gray-600 italic">{t('detail.noDescription')}</p>
              )}
            </div>
          )}
        </div>

        {/* Acceptance Criteria */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          {(() => {
            const statusMap = new Map<number, CriterionStatus>();
            (task.criteriaStatus || []).forEach((s) => statusMap.set(s.index, s));
            const metCount = Array.from(statusMap.values()).filter((s) => s.met).length;
            const hasStatus = statusMap.size > 0;
            return (
              <>
                <button onClick={() => toggle('criteria')} className="flex items-center gap-1 w-full text-left">
                  <IconChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${collapsed.criteria ? '-rotate-90' : ''}`} />
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                    {t('detail.acceptanceCriteria')}
                    {hasStatus && task.acceptanceCriteria?.length > 0 && (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        metCount === task.acceptanceCriteria.length
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                      }`}>
                        ({metCount}/{task.acceptanceCriteria.length} met)
                      </span>
                    )}
                  </h4>
                </button>
                {!collapsed.criteria && (task.acceptanceCriteria?.length > 0 ? (
                  <div className="space-y-1.5 mt-2">
                    {task.acceptanceCriteria.map((c, i) => {
                      const status = statusMap.get(i + 1);
                      const isCompleted = task.status === 'completed';
                      let iconClass: string;
                      let icon: string;
                      if (status) {
                        iconClass = status.met
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400';
                        icon = status.met ? '✓' : '✗';
                      } else if (isCompleted) {
                        iconClass = 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400';
                        icon = '✓';
                      } else {
                        iconClass = 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500';
                        icon = String(i + 1);
                      }
                      return (
                        <div key={i}>
                          <div className="flex items-start gap-2">
                            <span className={`w-5 h-5 rounded flex items-center justify-center text-xs flex-shrink-0 mt-0.5 ${iconClass}`}>
                              {icon}
                            </span>
                            <span className="text-sm text-gray-700 dark:text-gray-300">{c}</span>
                          </div>
                          {status?.note && (
                            <p className={`ml-7 mt-0.5 text-xs ${status.met ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                              {status.note}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-300 dark:text-gray-600 italic mt-2">{t('detail.noCriteria')}</p>
                ))}
              </>
            );
          })()}
        </div>

        {/* PM Criteria & Subtasks (from PM plugins) */}
        {(() => {
          // Build criteria list
          const allCriteria: { pluginId: string; id: string; description: string; completed: boolean }[] = localCriteria || [];
          if (!localCriteria && task.pluginContext) {
            for (const [pid, data] of Object.entries(task.pluginContext)) {
              if (data.criteria) {
                for (const cr of data.criteria) {
                  allCriteria.push({ pluginId: pid, ...cr });
                }
              }
            }
          }

          // Build subtask list
          const allSubtasks: { pluginId: string; id: string; description: string; completed: boolean }[] = localSubtasks || [];
          if (!localSubtasks && task.pluginContext) {
            for (const [pid, data] of Object.entries(task.pluginContext)) {
              if (data.subtasks) {
                for (const st of data.subtasks) {
                  allSubtasks.push({ pluginId: pid, ...st });
                }
              }
            }
          }

          if (!task.pmWorkItemId && allCriteria.length === 0 && allSubtasks.length === 0) return null;

          const handleRefreshPm = async () => {
            setRefreshingPmData(true);
            try {
              const updated = await refreshSubtasks(task.id);
              if (updated.pluginContext) {
                const refreshedSt: typeof allSubtasks = [];
                const refreshedCr: typeof allCriteria = [];
                for (const [pid, data] of Object.entries(updated.pluginContext)) {
                  if (data.subtasks) for (const st of data.subtasks) refreshedSt.push({ pluginId: pid, ...st });
                  if (data.criteria) for (const cr of data.criteria) refreshedCr.push({ pluginId: pid, ...cr });
                }
                setLocalSubtasks(refreshedSt);
                setLocalCriteria(refreshedCr);
              }
            } catch (err) {
              console.error('Failed to refresh PM data:', err);
            } finally {
              setRefreshingPmData(false);
            }
          };

          const criteriaDone = allCriteria.filter((c) => c.completed).length;
          const subtasksDone = allSubtasks.filter((s) => s.completed).length;

          return (
            <>
              {/* PM Criteria */}
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-1">
                  <button onClick={() => toggle('pmCriteria')} className="flex items-center gap-1 flex-1 text-left">
                    <IconChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${collapsed.pmCriteria ? '-rotate-90' : ''}`} />
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                      {t('detail.pmCriteria', 'PM Criteria')}
                      {allCriteria.length > 0 && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          criteriaDone === allCriteria.length
                            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                        }`}>
                          {t('detail.subtasksDone', { done: criteriaDone, total: allCriteria.length })}
                        </span>
                      )}
                    </h4>
                  </button>
                  {task.pmWorkItemId && (
                    <button
                      onClick={handleRefreshPm}
                      disabled={refreshingPmData}
                      title={t('detail.refreshSubtasks', 'Refresh from PM')}
                      className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
                    >
                      <IconRefresh className={`w-3.5 h-3.5 ${refreshingPmData ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                </div>
                {!collapsed.pmCriteria && (
                  allCriteria.length > 0 ? (
                    <div className="space-y-1.5 mt-2">
                      {allCriteria.map((cr) => (
                        <label key={cr.id} className="flex items-center gap-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={cr.completed}
                            onChange={() => {
                              const newVal = !cr.completed;
                              // Optimistic update
                              setLocalCriteria((prev) => {
                                const list = prev || allCriteria;
                                return list.map((c) => c.id === cr.id ? { ...c, completed: newVal } : c);
                              });
                              completeCriterion(task.id, cr.pluginId, cr.id, newVal).catch((err) => {
                                console.error('Failed to toggle criterion:', err);
                                // Revert on error
                                setLocalCriteria((prev) => prev && prev.map((c) => c.id === cr.id ? { ...c, completed: !newVal } : c));
                              });
                            }}
                            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500 dark:bg-gray-700"
                          />
                          <span className={`text-sm ${cr.completed ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                            {cr.description}
                          </span>
                          <span className="text-[10px] text-gray-300 dark:text-gray-600 font-mono ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                            {cr.id}
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 italic">
                      {t('detail.noPmCriteria', 'No PM criteria. Click refresh to fetch.')}
                    </p>
                  )
                )}
              </div>

              {/* PM Subtasks */}
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-1">
                  <button onClick={() => toggle('subtasks')} className="flex items-center gap-1 flex-1 text-left">
                    <IconChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${collapsed.subtasks ? '-rotate-90' : ''}`} />
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                      {t('detail.subtasks')}
                      {allSubtasks.length > 0 && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          subtasksDone === allSubtasks.length
                            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                        }`}>
                          {t('detail.subtasksDone', { done: subtasksDone, total: allSubtasks.length })}
                        </span>
                      )}
                    </h4>
                  </button>
                  {task.pmWorkItemId && (
                    <button
                      onClick={handleRefreshPm}
                      disabled={refreshingPmData}
                      title={t('detail.refreshSubtasks', 'Refresh from PM')}
                      className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
                    >
                      <IconRefresh className={`w-3.5 h-3.5 ${refreshingPmData ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                </div>
                {!collapsed.subtasks && (
                  allSubtasks.length > 0 ? (
                    <div className="space-y-1.5 mt-2">
                      {allSubtasks.map((st) => (
                        <label key={st.id} className="flex items-center gap-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={st.completed}
                            onChange={() => {
                              const newVal = !st.completed;
                              // Optimistic update
                              setLocalSubtasks((prev) => {
                                const list = prev || allSubtasks;
                                return list.map((s) => s.id === st.id ? { ...s, completed: newVal } : s);
                              });
                              completeSubtask(task.id, st.pluginId, st.id, newVal).catch((err) => {
                                console.error('Failed to toggle subtask:', err);
                                // Revert on error
                                setLocalSubtasks((prev) => prev && prev.map((s) => s.id === st.id ? { ...s, completed: !newVal } : s));
                              });
                            }}
                            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500 dark:bg-gray-700"
                          />
                          <span className={`text-sm ${st.completed ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                            {st.description}
                          </span>
                          <span className="text-[10px] text-gray-300 dark:text-gray-600 font-mono ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                            {st.id}
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 italic">
                      {t('detail.noSubtasks', 'No subtasks yet. Click refresh to fetch from PM.')}
                    </p>
                  )
                )}
              </div>
            </>
          );
        })()}

        {/* Images */}
        {task.images?.length > 0 && (
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('detail.referenceImages')}</h4>
            <div className="flex gap-2 flex-wrap">
              {task.images.map((img, i) => (
                <div key={i} className="bg-gray-100 dark:bg-gray-700 rounded-lg p-1.5 group relative">
                  <img
                    src={img.url}
                    alt=""
                    className="w-24 h-16 object-cover rounded cursor-pointer"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                  <div className="hidden w-24 h-16 bg-gray-200 dark:bg-gray-600 rounded flex items-center justify-center text-gray-400">
                    <IconImage className="w-5 h-5" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Activity log for this task */}
        {taskLogs.length > 0 && (
          <div className="px-6 py-4">
            <button onClick={() => toggle('activity')} className="flex items-center gap-1 w-full text-left">
              <IconChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${collapsed.activity ? '-rotate-90' : ''}`} />
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('detail.activity')}</h4>
            </button>
            {!collapsed.activity && (
              <>
                <div
                  onMouseDown={onDragStart}
                  className="flex items-center justify-center cursor-row-resize group py-1 mb-1"
                >
                  <div className="w-10 h-1 rounded-full bg-gray-700 group-hover:bg-gray-500 transition-colors" />
                </div>
                <div className="bg-gray-950 rounded-lg p-3 overflow-y-auto font-mono text-xs space-y-1" style={{ height: activityHeight }}>
                  {taskLogs.map((l) => (
                    <div key={l.id} className="flex gap-3 text-gray-400">
                      <span className="text-gray-600 flex-shrink-0">
                        {formatTime(l.createdAt)}
                      </span>
                      <span className={l.kind === 'ok' ? 'text-emerald-400' : l.kind === 'error' ? 'text-red-400' : 'text-gray-300'}>
                        {l.message}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Injected Action Modal */}
      {actionModalPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setActionModalPrompt(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('detail.coworkPrompt', 'QA Prompt')}</h3>
              <button onClick={() => setActionModalPrompt(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <IconX className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono bg-gray-50 dark:bg-gray-900 rounded-lg p-4">{actionModalPrompt}</pre>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(actionModalPrompt);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="text-xs bg-violet-600 hover:bg-violet-700 text-white font-medium px-4 py-2 rounded-lg flex items-center gap-1"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {copied ? t('detail.copied', 'Copied!') : t('detail.copyPrompt', 'Copy Prompt')}
              </button>
              <button onClick={() => setActionModalPrompt(null)} className="text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium px-4 py-2 rounded-lg">
                {t('common:button.close', 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
