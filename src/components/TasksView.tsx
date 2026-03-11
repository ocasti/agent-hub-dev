import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Task, Project, Log, ActiveAgent, Settings, LicenseLimits, TaskStatus } from '../lib/types';
import { executePluginOperation } from '../lib/ipc';
import Badge from './ui/Badge';
import ProgressBar from './ui/ProgressBar';
import MultiSelectDropdown from './ui/MultiSelectDropdown';
import TaskForm from './TaskForm';
import TaskDetail from './TaskDetail';
import BulkImportModal, { type ImportItem } from './BulkImportModal';
import { IconPlay, IconRuler, IconEdit, IconPause, IconDownload, IconCircleCheck, IconRetry } from './ui/Icons';

interface TasksViewProps {
  tasks: Task[];
  projects: Project[];
  logs: Log[];
  agents: Map<string, ActiveAgent>;
  settings: Settings;
  licenseLimits?: LicenseLimits;
  pendingEditTaskId?: string | null;
  pendingDetailTaskId?: string | null;
  onClearPendingEdit?: () => void;
  onClearPendingDetail?: () => void;
  onCreateTask: (data: Partial<Task>) => void;
  onUpdateTask: (id: string, data: Partial<Task>) => void;
  onDeleteTask: (id: string) => void;
  onStartTask: (task: Task) => void;
  onStopTask: (task: Task) => void;
  onContinueSpec: (task: Task, action: 'accept' | 'edit', editedSpec?: string) => void;
  onContinuePlan: (task: Task, action: 'approve' | 'replan') => void;
  onFetchAndFix: (task: Task) => void;
  onApproveTask: (task: Task) => void;
  onSyncRemote?: (task: Task) => void;
  onSyncParent?: (task: Task) => void;
  onApprovePush?: (task: Task) => void;
  onRejectPush?: (task: Task) => void;
  onRevisePush?: (task: Task, prompt: string) => void;
  onFixTests?: (task: Task) => void;
  onUpdateSetting?: (key: string, value: string) => void;
}

export default function TasksView({
  tasks, projects, logs, agents, settings, licenseLimits, pendingEditTaskId, pendingDetailTaskId, onClearPendingEdit, onClearPendingDetail,
  onCreateTask, onUpdateTask, onDeleteTask, onStartTask, onStopTask, onContinueSpec, onContinuePlan, onFetchAndFix, onApproveTask,
  onSyncRemote, onSyncParent, onApprovePush, onRejectPush, onRevisePush, onFixTests, onUpdateSetting,
}: TasksViewProps) {
  const { t } = useTranslation(['tasks', 'common', 'workflow']);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [filterProjects, setFilterProjects] = useState<string[]>(settings.tasksFilterProjects || []);
  const [filterStatuses, setFilterStatuses] = useState<string[]>(settings.tasksFilterStatuses || []);
  const [showBulkImport, setShowBulkImport] = useState(false);

  useEffect(() => {
    if (pendingEditTaskId) {
      const task = tasks.find((t) => t.id === pendingEditTaskId);
      if (task) {
        setEditing(task);
        setCreating(false);
        setDetailId(null);
      }
      onClearPendingEdit?.();
    }
  }, [pendingEditTaskId]);

  useEffect(() => {
    if (pendingDetailTaskId) {
      setDetailId(pendingDetailTaskId);
      setEditing(null);
      setCreating(false);
      onClearPendingDetail?.();
    }
  }, [pendingDetailTaskId]);

  const isRunning = (status: string) =>
    !['queued', 'completed', 'failed', 'pr_feedback', 'spec_feedback', 'plan_review', 'push_review', 'test_fixing'].includes(status);

  const runningTasks = tasks.filter((t) => isRunning(t.status));

  // A project is "busy" if it has reached its parallel task limit
  const maxParallel = licenseLimits?.max_parallel_per_project ?? 1;
  const getProjectRunningCount = (projectId: string, excludeTaskId?: string) =>
    runningTasks.filter((t) => t.projectId === projectId && t.id !== excludeTaskId).length;
  const isProjectBusy = (projectId: string, excludeTaskId?: string) =>
    getProjectRunningCount(projectId, excludeTaskId) >= maxParallel;

  const canStartTask = (task: Task) => {
    if (runningTasks.length >= settings.maxConcurrent) return false;
    if (isProjectBusy(task.projectId, task.id)) return false;
    return true;
  };

  // Track already-imported PM work item IDs to avoid duplicates
  const existingPmIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) {
      if (t.pmWorkItemId) ids.add(t.pmWorkItemId);
    }
    return ids;
  }, [tasks]);

  // Check if any project has a PM plugin active (to show Import button)
  const hasPmPlugin = useMemo(() => projects.some((p) => p.pluginPm), [projects]);

  // Fetch PM statuses for all tasks with PM links (single MCP call per plugin)
  const [pmStatuses, setPmStatuses] = useState<Record<string, string>>({});
  useEffect(() => {
    const pmPluginIds = new Set(projects.filter((p) => p.pluginPm).map((p) => p.pluginPm!));
    if (pmPluginIds.size === 0 || !tasks.some((t) => t.pmWorkItemId)) return;
    for (const pluginId of pmPluginIds) {
      executePluginOperation(pluginId, 'listMyWork', { __raw: 'true' })
        .then((raw) => {
          const items = Array.isArray(raw) ? raw : [];
          const map: Record<string, string> = {};
          for (const item of items) {
            const r = item as Record<string, unknown>;
            const id = String(r.id || '');
            const status = r.status_name || r.statusName || r.status || r.state;
            if (id && status) map[id] = String(status);
          }
          setPmStatuses((prev) => ({ ...prev, ...map }));
        })
        .catch(() => { /* non-critical */ });
    }
  }, [projects, tasks.length]);

  function handleBulkImport(projectId: string, items: ImportItem[]) {
    for (const item of items) {
      onCreateTask({
        projectId,
        title: item.title,
        description: item.description,
        acceptanceCriteria: item.acceptanceCriteria,
        pmWorkItemId: item.pmWorkItemId,
      });
    }
    setShowBulkImport(false);
  }

  // Available statuses from current tasks (for filter dropdown)
  // NOTE: All hooks must be called before any conditional returns
  const availableStatuses = useMemo(() => {
    const statuses = new Set(tasks.map((tk) => tk.status));
    return Array.from(statuses).sort();
  }, [tasks]);

  // Persist filter changes to DB
  function handleFilterProjectsChange(selected: string[]) {
    setFilterProjects(selected);
    onUpdateSetting?.('tasks_filter_projects', JSON.stringify(selected));
  }
  function handleFilterStatusesChange(selected: string[]) {
    setFilterStatuses(selected);
    onUpdateSetting?.('tasks_filter_statuses', JSON.stringify(selected));
  }

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (filterProjects.length > 0) {
      result = result.filter((tk) => filterProjects.includes(tk.projectId));
    }
    if (filterStatuses.length > 0) {
      result = result.filter((tk) => filterStatuses.includes(tk.status));
    }
    return result;
  }, [tasks, filterProjects, filterStatuses]);

  // Task detail view
  const detailTask = detailId ? tasks.find((t) => t.id === detailId) : null;
  if (detailTask && !editing) {
    const project = projects.find((p) => p.id === detailTask.projectId);
    return (
      <TaskDetail
        task={detailTask}
        project={project}
        agent={agents.get(detailTask.id)}
        logs={logs}
        onBack={() => setDetailId(null)}
        onEdit={() => setEditing(detailTask)}
        onStart={() => { if (canStartTask(detailTask)) { onStartTask(detailTask); } }}
        onStop={() => { onStopTask(detailTask); }}
        onRefineSpec={() => setEditing(detailTask)}
        onContinueSpec={() => {
          onContinueSpec(detailTask, 'accept');
          setDetailId(null);
        }}
        onApprovePlan={() => { onContinuePlan(detailTask, 'approve'); }}
        onReplan={() => { onContinuePlan(detailTask, 'replan'); }}
        onFetchAndFix={() => { if (canStartTask(detailTask)) { onFetchAndFix(detailTask); } }}
        onApprove={() => { onApproveTask(detailTask); }}
        onSyncRemote={() => { onSyncRemote?.(detailTask); }}
        onSyncParent={() => { onSyncParent?.(detailTask); }}
        onApprovePush={() => { onApprovePush?.(detailTask); }}
        onRejectPush={() => { onRejectPush?.(detailTask); }}
        onRevisePush={(prompt: string) => { onRevisePush?.(detailTask, prompt); }}
        onFixTests={() => { onFixTests?.(detailTask); }}
        onDelete={() => { onDeleteTask(detailTask.id); setDetailId(null); }}
      />
    );
  }

  // Edit form view
  if (editing) {
    return (
      <TaskForm
        projects={projects}
        task={editing}
        licenseLimits={licenseLimits}
        onSave={(data) => {
          if (editing.status === 'spec_feedback') {
            // Resume workflow with edited spec via continueSpec IPC
            onUpdateTask(editing.id, { ...data });
            onContinueSpec(editing, 'edit', data.description as string);
          } else {
            const wasStarted = editing.status !== 'queued';
            onUpdateTask(editing.id, {
              ...data,
              status: wasStarted ? 'queued' : editing.status,
              reviewCycle: wasStarted ? 0 : editing.reviewCycle,
            });
          }
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  // Create form view
  if (creating) {
    return (
      <TaskForm
        projects={projects}
        licenseLimits={licenseLimits}
        onSave={(data) => {
          onCreateTask(data);
          setCreating(false);
        }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  // List view grouped by project
  const tasksByProject: Record<string, { name: string; tasks: Task[] }> = {};
  filteredTasks.forEach((tk) => {
    const key = tk.projectId || 'no-project';
    if (!tasksByProject[key]) tasksByProject[key] = { name: tk.projectName || t('noProject'), tasks: [] };
    tasksByProject[key].tasks.push(tk);
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('header.title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('header.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {hasPmPlugin && (
            <button
              onClick={() => setShowBulkImport(true)}
              className="border border-indigo-300 dark:border-indigo-600 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-sm font-medium px-4 py-2 rounded-lg"
            >
              {t('button.import', 'Import from PM')}
            </button>
          )}
          <button onClick={() => setCreating(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {t('button.new')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <MultiSelectDropdown
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          selected={filterProjects}
          onChange={handleFilterProjectsChange}
          placeholder={t('filter.allProjects', 'All projects')}
        />
        <MultiSelectDropdown
          options={availableStatuses.map((s) => ({ value: s, label: t(`workflow:status.${s}`, s) }))}
          selected={filterStatuses}
          onChange={handleFilterStatusesChange}
          placeholder={t('filter.allStatuses', 'All statuses')}
        />
        {(filterProjects.length > 0 || filterStatuses.length > 0) && (
          <button
            onClick={() => { handleFilterProjectsChange([]); handleFilterStatusesChange([]); }}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            {t('filter.clear', 'Clear filters')}
          </button>
        )}
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
          {filteredTasks.length}/{tasks.length} {t('filter.showing', 'tasks')}
        </span>
      </div>

      {Object.keys(tasksByProject).length === 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-12 text-center text-gray-400">
          <p className="text-lg mb-1">{t('empty.title')}</p>
        </div>
      )}

      {Object.entries(tasksByProject).map(([projId, group]) => {
        const proj = projects.find((p) => p.id === projId);
        const activeSkills = proj?.optionalSkills?.length || 0;
        return (
          <div key={projId} className="space-y-2">
            <div className="flex items-center gap-3 px-1">
              <div className="w-7 h-7 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center text-white text-xs font-bold">
                {group.name[0]?.toUpperCase()}
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">{group.name}</h3>
                <p className="text-xs text-gray-400">
                  {t('tasks_count', { count: group.tasks.length })}
                  {activeSkills > 0 ? ` · ${t('skills_count', { count: 8 + activeSkills })}` : ` · ${t('coreSkills', { count: 8 })}`}
                </p>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {group.tasks.map((task) => {
                  const ag = agents.get(task.id);
                  return (
                    <div key={task.id} className="px-5 py-4 hover:bg-gray-50/30 dark:hover:bg-gray-700/30">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setDetailId(task.id)}>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                            {task.title}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {task.acceptanceCriteria?.length > 0 && (
                              <span className="text-xs text-gray-300">{t('criteria_count', { count: task.acceptanceCriteria.length })}</span>
                            )}
                            {task.images?.length > 0 && (
                              <span className="text-xs text-gray-300">· {t('images_count', { count: task.images.length })}</span>
                            )}
                            {task.reviewCycle > 0 && (
                              <span className="text-xs text-gray-300">· {t('cycle', { cycle: task.reviewCycle })}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${task.model === 'opus' ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                            {task.model}
                          </span>
                          {(ag?.pr || task.prNumber) && (
                            <span className="text-xs bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded font-mono">
                              PR #{ag?.pr || task.prNumber}
                            </span>
                          )}
                          {task.pmWorkItemId && (
                            task.pmWorkItemUrl ? (
                              <a
                                href={task.pmWorkItemUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                                title="Open in PM tool"
                              >
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                                PM{pmStatuses[task.pmWorkItemId] ? `: ${pmStatuses[task.pmWorkItemId]}` : ''}
                              </a>
                            ) : (
                              <span className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded">
                                PM{pmStatuses[task.pmWorkItemId] ? `: ${pmStatuses[task.pmWorkItemId]}` : ''}
                              </span>
                            )
                          )}
                          <Badge status={task.status} />
                          {task.worktreePath && (
                            <span className="text-[10px] bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400 px-1.5 py-0.5 rounded font-medium">
                              Worktree
                            </span>
                          )}
                          {task.status === 'queued' && !ag && (task.lastPhase ?? -1) <= -1 && (
                            isProjectBusy(task.projectId, task.id) ? (
                              <span className="text-xs text-gray-400 dark:text-gray-500 italic">{t('common:project.busy')}</span>
                            ) : (
                              <button
                                onClick={() => { if (canStartTask(task)) onStartTask(task); }}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                              >
                                <IconPlay className="w-3 h-3" /> {t('button.start')}
                              </button>
                            )
                          )}
                          {task.status === 'queued' && !ag && (task.lastPhase ?? -1) > -1 && (
                            isProjectBusy(task.projectId, task.id) ? (
                              <span className="text-xs text-gray-400 dark:text-gray-500 italic">{t('common:project.busy')}</span>
                            ) : (
                              <button
                                onClick={() => { if (canStartTask(task)) onStartTask(task); }}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1"
                              >
                                <IconPlay className="w-3 h-3" /> {t('button.resume')}
                              </button>
                            )
                          )}
                          {task.status === 'failed' && !ag && (
                            isProjectBusy(task.projectId, task.id) ? (
                              <span className="text-xs text-gray-400 dark:text-gray-500 italic">{t('common:project.busy')}</span>
                            ) : (
                              <button
                                onClick={() => { if (canStartTask(task)) onStartTask(task); }}
                                className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1"
                              >
                                <IconRetry className="w-3 h-3" /> {t('button.retry')}
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      {task.status === 'spec_feedback' && (
                        <div className="mt-3 bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 rounded-lg p-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="text-xs font-semibold text-cyan-800 flex items-center gap-1"><IconRuler className="w-3 h-3" /> {t('specNeedsRefinement')}</p>
                              {task.specSuggestions && task.specSuggestions.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {task.specSuggestions.map((s, i) => (
                                    <div key={i} className="flex items-start gap-2">
                                      <span className="text-cyan-500 text-xs mt-0.5">-&gt;</span>
                                      <span className="text-xs text-cyan-700">{s}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                              <button onClick={() => setDetailId(task.id)} className="bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
                                <IconEdit className="w-3 h-3" /> {t('button.refineSpec')}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {task.status === 'plan_review' && (
                        <div className="mt-3 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-lg p-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="text-xs font-semibold text-sky-800 dark:text-sky-300 flex items-center gap-1"><IconRuler className="w-3 h-3" /> {t('planReadyForApproval')}</p>
                              {task.planSummary && (
                                <pre className="mt-2 text-xs text-sky-700 dark:text-sky-400 whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">{task.planSummary.substring(0, 500)}{task.planSummary.length > 500 ? '...' : ''}</pre>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                              {isProjectBusy(task.projectId, task.id) ? (
                                <span className="text-xs text-gray-400 dark:text-gray-500 italic">{t('common:project.busy')}</span>
                              ) : (
                                <>
                                  <button onClick={() => onContinuePlan(task, 'approve')} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
                                    <IconCircleCheck className="w-3 h-3" /> {t('button.approve')}
                                  </button>
                                  <button onClick={() => onContinuePlan(task, 'replan')} className="bg-gray-500 hover:bg-gray-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
                                    <IconEdit className="w-3 h-3" /> {t('button.replan')}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {task.status === 'push_review' && (
                        <div className="mt-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1"><IconPause className="w-3 h-3" /> {t('pushReadyForApproval', 'Push ready for approval')}</p>
                              {task.planSummary && (
                                <pre className="mt-2 text-xs text-amber-700 dark:text-amber-400 whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">{task.planSummary.substring(0, 500)}{task.planSummary.length > 500 ? '...' : ''}</pre>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                              <button onClick={() => setDetailId(task.id)} className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
                                <IconCircleCheck className="w-3 h-3" /> {t('button.reviewPush', 'Review')}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {task.status === 'test_fixing' && (
                        <div className="mt-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-red-800 dark:text-red-300 flex items-center gap-1"><IconPause className="w-3 h-3" /> {t('testsFailingPaused')}</p>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                              {isProjectBusy(task.projectId, task.id) ? (
                                <span className="text-xs text-gray-400 dark:text-gray-500 italic">{t('common:project.busy')}</span>
                              ) : (
                                <button onClick={() => onFixTests?.(task)} className="bg-red-600 hover:bg-red-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
                                  <IconRetry className="w-3 h-3" /> {t('button.fixTests')}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {task.status === 'pr_feedback' && (
                        <div className="mt-3 bg-pink-50 dark:bg-pink-900/20 border border-pink-200 dark:border-pink-800 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-pink-800 flex items-center gap-1"><IconPause className="w-3 h-3" /> {t('awaitingPRReview', { prNumber: task.prNumber })}</p>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                              {isProjectBusy(task.projectId, task.id) ? (
                                <span className="text-xs text-gray-400 dark:text-gray-500 italic">{t('common:project.busy')}</span>
                              ) : (
                                <button onClick={() => onFetchAndFix(task)} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
                                  <IconDownload className="w-3 h-3" /> {t('button.fetchAndFix')}
                                </button>
                              )}
                              <button onClick={() => onApproveTask(task)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
                                <IconCircleCheck className="w-3 h-3" /> {t('button.approve')}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {(isRunning(task.status) || ag) && (
                        <div className="mt-2">
                          <ProgressBar agent={ag} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

      {showBulkImport && (
        <BulkImportModal
          projects={projects}
          existingPmIds={existingPmIds}
          onImport={handleBulkImport}
          onClose={() => setShowBulkImport(false)}
        />
      )}
    </div>
  );
}
