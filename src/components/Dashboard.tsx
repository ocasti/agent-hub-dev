import { useTranslation } from 'react-i18next';
import type { Task, Log, Settings, ActiveAgent, UpdateInfo, UpdateProgress, PluginCompatResult } from '../lib/types';
import Badge from './ui/Badge';
import ProgressBar from './ui/ProgressBar';
import { IconRuler, IconPause, IconEdit, IconCheck, IconDownload, IconCircleCheck, IconPlay } from './ui/Icons';

/** Strip HTML tags and decode common entities — safety net for release notes */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface DashboardProps {
  tasks: Task[];
  logs: Log[];
  settings: Settings;
  agents: Map<string, ActiveAgent>;
  updateAvailable?: UpdateInfo | null;
  updateProgress?: UpdateProgress | null;
  updateDownloaded?: UpdateInfo | null;
  pluginCompatWarnings?: PluginCompatResult[];
  onDownloadUpdate?: () => void;
  onInstallUpdate?: () => void;
  onSkipUpdate?: (version: string) => void;
  onRefineSpec: (task: Task) => void;
  onContinueSpec: (task: Task) => void;
  onContinuePlan: (task: Task, action: 'approve' | 'replan') => void;
  onFetchAndFix: (task: Task) => void;
  onApproveTask: (task: Task) => void;
  onNavigateToTask: (task: Task) => void;
}

export default function Dashboard({ tasks, logs, settings, agents, updateAvailable, updateProgress, updateDownloaded, pluginCompatWarnings, onDownloadUpdate, onInstallUpdate, onSkipUpdate, onRefineSpec, onContinueSpec, onContinuePlan, onFetchAndFix, onApproveTask, onNavigateToTask }: DashboardProps) {
  const { t } = useTranslation(['dashboard', 'common', 'tasks']);

  const agentRunning = tasks.filter(
    (t) => !['queued', 'completed', 'failed', 'pr_feedback', 'spec_feedback', 'plan_review', 'push_review', 'test_fixing'].includes(t.status)
  );
  const specWaiting = tasks.filter((t) => t.status === 'spec_feedback');
  const planWaiting = tasks.filter((t) => t.status === 'plan_review');
  const prWaiting = tasks.filter((t) => t.status === 'pr_feedback');
  const pendingAction = specWaiting.length + planWaiting.length + prWaiting.length;
  const runCount = agentRunning.length;

  // A project is "busy" if ANY task is actively RUNNING (not paused, not terminal)
  const isProjectBusy = (projectId: string, excludeTaskId?: string) =>
    agentRunning.some((t) => t.projectId === projectId && t.id !== excludeTaskId);

  const counters = [
    { label: t('counter.activeAgents'), value: runCount, style: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' },
    { label: t('counter.needAction'), value: pendingAction, style: pendingAction > 0 ? 'text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/20 border-cyan-200 dark:border-cyan-800' : 'text-gray-400 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700' },
    { label: t('counter.queued'), value: tasks.filter((t) => t.status === 'queued').length, style: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' },
    { label: t('counter.completed'), value: tasks.filter((t) => t.status === 'completed').length, style: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' },
    { label: t('counter.projects'), value: new Set(tasks.map((t) => t.projectId)).size, style: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('header.title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('header.subtitle')}</p>
        </div>
        <div className="text-xs text-gray-400 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 rounded-lg border dark:border-gray-700">
          <span className={`inline-block w-2 h-2 rounded-full mr-1.5 align-middle ${runCount > 0 ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'}`} />
          {t('agents.status', { running: runCount, max: settings.maxConcurrent })}
        </div>
      </div>

      {/* Update available banner */}
      {updateDownloaded && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              {t('update.readyTitle', { version: updateDownloaded.version, defaultValue: `Update v${updateDownloaded.version} ready to install` })}
            </p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
              {t('update.readySubtitle', 'Restart the app to apply the update.')}
            </p>
          </div>
          <button
            onClick={onInstallUpdate}
            className="text-xs font-medium px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {t('update.restart', 'Restart to Update')}
          </button>
        </div>
      )}

      {updateAvailable && !updateDownloaded && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">
              {t('update.availableTitle', { version: updateAvailable.version, defaultValue: `Update v${updateAvailable.version} available` })}
            </p>
            {updateAvailable.releaseNotes && (
              <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5 truncate">
                {stripHtml(updateAvailable.releaseNotes).substring(0, 120)}
              </p>
            )}
            {updateProgress && (
              <div className="mt-2 w-full bg-indigo-200 dark:bg-indigo-800 rounded-full h-1.5">
                <div
                  className="bg-indigo-600 h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.round(updateProgress.percent)}%` }}
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 ml-4 flex-shrink-0">
            {!updateProgress && (
              <>
                <button
                  onClick={onDownloadUpdate}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  {t('update.download', 'Download')}
                </button>
                <button
                  onClick={() => onSkipUpdate?.(updateAvailable.version)}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  {t('update.skip', 'Skip')}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Plugin compatibility warnings */}
      {pluginCompatWarnings && pluginCompatWarnings.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            {t('update.pluginWarning', { count: pluginCompatWarnings.length, defaultValue: `${pluginCompatWarnings.length} plugin(s) may be incompatible` })}
          </p>
          <div className="mt-2 space-y-1">
            {pluginCompatWarnings.map((w) => (
              <p key={w.pluginId} className="text-xs text-amber-700 dark:text-amber-400">
                {w.name}: {w.reason}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-5 gap-4">
        {counters.map((c) => (
          <div key={c.label} className={`border rounded-xl p-4 ${c.style}`}>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{c.label}</p>
            <p className="text-2xl font-bold mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      {agentRunning.length > 0 && (
        <h3 className="text-sm font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
          <IconPlay className="w-4 h-4" /> {t('section.running', { count: agentRunning.length })}
        </h3>
      )}

      {agentRunning.map((task) => {
        const ag = agents.get(task.id);
        return (
          <div key={task.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-700 text-xs font-bold">
                  {task.projectName?.[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer" onClick={() => onNavigateToTask(task)}>{task.title}</p>
                  <p className="text-xs text-gray-400">{task.projectName}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {ag?.pr && (
                  <span className="text-xs bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded font-mono">
                    PR #{ag.pr}
                  </span>
                )}
                <Badge status={task.status} />
              </div>
            </div>
            <ProgressBar agent={ag} />
          </div>
        );
      })}

      {specWaiting.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-cyan-700 flex items-center gap-1.5">
            <IconRuler className="w-4 h-4" /> {t('section.specRefine', { count: specWaiting.length })}
          </h3>
          {specWaiting.map((task) => (
            <div key={task.id} className="bg-white dark:bg-gray-800 border border-cyan-200 dark:border-cyan-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-cyan-100 dark:bg-cyan-900/40 rounded-lg flex items-center justify-center text-cyan-700 dark:text-cyan-400 text-xs font-bold">
                    {task.projectName?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer" onClick={() => onNavigateToTask(task)}>{task.title}</p>
                    <p className="text-xs text-gray-400">{task.projectName}</p>
                  </div>
                </div>
                <Badge status="spec_feedback" />
              </div>
              {task.specSuggestions && task.specSuggestions.length > 0 && (
                <div className="bg-cyan-50 dark:bg-cyan-900/30 rounded-lg p-3 space-y-1.5">
                  {task.specSuggestions.map((s, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-cyan-500 text-xs mt-0.5">-&gt;</span>
                      <span className="text-xs text-cyan-800 dark:text-cyan-300">{s}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => onRefineSpec(task)}
                  className="flex items-center gap-1.5 text-xs bg-cyan-600 hover:bg-cyan-700 text-white font-medium px-3 py-1.5 rounded-lg"
                >
                  <IconEdit className="w-3 h-3" /> {t('tasks:button.refineSpec')}
                </button>
                {isProjectBusy(task.projectId, task.id) ? (
                  <span className="text-xs text-gray-400 dark:text-gray-500 italic">{t('common:project.busy')}</span>
                ) : (
                  <button
                    onClick={() => onContinueSpec(task)}
                    className="flex items-center gap-1.5 text-xs bg-gray-500 hover:bg-gray-600 text-white font-medium px-3 py-1.5 rounded-lg"
                  >
                    <IconCheck className="w-3 h-3" /> {t('tasks:button.continueAsIs')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {planWaiting.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-sky-700 dark:text-sky-400 flex items-center gap-1.5">
            <IconRuler className="w-4 h-4" /> {t('section.planApproval', { count: planWaiting.length })}
          </h3>
          {planWaiting.map((task) => (
            <div key={task.id} className="bg-white dark:bg-gray-800 border border-sky-200 dark:border-sky-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-sky-100 dark:bg-sky-900/40 rounded-lg flex items-center justify-center text-sky-700 dark:text-sky-400 text-xs font-bold">
                    {task.projectName?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer" onClick={() => onNavigateToTask(task)}>{task.title}</p>
                    <p className="text-xs text-gray-400">{task.projectName}</p>
                  </div>
                </div>
                <Badge status="plan_review" />
              </div>
              {task.planSummary && (
                <div className="bg-sky-50 dark:bg-sky-900/30 rounded-lg p-3 max-h-48 overflow-y-auto">
                  <pre className="text-xs text-sky-800 dark:text-sky-300 whitespace-pre-wrap font-mono">{task.planSummary}</pre>
                </div>
              )}
              <div className="flex items-center gap-2 mt-3">
                {isProjectBusy(task.projectId, task.id) ? (
                  <span className="text-xs text-gray-400 dark:text-gray-500 italic">{t('common:project.busy')}</span>
                ) : (
                  <>
                    <button
                      onClick={() => onContinuePlan(task, 'approve')}
                      className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1.5 rounded-lg"
                    >
                      <IconCheck className="w-3 h-3" /> {t('tasks:button.approveAndImplement')}
                    </button>
                    <button
                      onClick={() => onContinuePlan(task, 'replan')}
                      className="flex items-center gap-1.5 text-xs bg-gray-500 hover:bg-gray-600 text-white font-medium px-3 py-1.5 rounded-lg"
                    >
                      <IconEdit className="w-3 h-3" /> {t('tasks:button.replan')}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {prWaiting.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-pink-700 flex items-center gap-1.5">
            <IconPause className="w-4 h-4" /> {t('section.prReview', { count: prWaiting.length })}
          </h3>
          {prWaiting.map((task) => (
            <div key={task.id} className="bg-white dark:bg-gray-800 border border-pink-200 dark:border-pink-800 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-pink-100 dark:bg-pink-900/40 rounded-lg flex items-center justify-center text-pink-700 dark:text-pink-400 text-xs font-bold">
                    {task.projectName?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer" onClick={() => onNavigateToTask(task)}>{task.title}</p>
                    <p className="text-xs text-gray-400">
                      {task.projectName}
                      {task.reviewCycle > 0 && <span className="ml-1 text-pink-500">· {t('tasks:cycle', { cycle: task.reviewCycle })}</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded font-mono">
                    PR #{task.prNumber}
                  </span>
                  <Badge status="pr_feedback" />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3">
                {isProjectBusy(task.projectId, task.id) ? (
                  <span className="text-xs text-gray-400 dark:text-gray-500 italic">{t('common:project.busy')}</span>
                ) : (
                  <button
                    onClick={() => onFetchAndFix(task)}
                    className="flex items-center gap-1.5 text-xs bg-orange-500 hover:bg-orange-600 text-white font-medium px-3 py-1.5 rounded-lg"
                  >
                    <IconDownload className="w-3 h-3" /> {t('tasks:button.fetchAndFix')}
                  </button>
                )}
                <button
                  onClick={() => onApproveTask(task)}
                  className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1.5 rounded-lg"
                >
                  <IconCircleCheck className="w-3 h-3" /> {t('tasks:button.approve')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
