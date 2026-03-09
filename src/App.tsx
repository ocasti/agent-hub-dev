import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project, Task, Log, Settings, ActiveAgent, LicenseLimits, TierName, UpdateInfo, UpdateProgress, PluginCompatResult } from './lib/types';
import * as ipc from './lib/ipc';
import Sidebar, { type ViewId } from './components/Sidebar';
import Dashboard from './components/Dashboard';
import TasksView from './components/TasksView';
import ProjectsView from './components/ProjectsView';
import WorkflowView from './components/WorkflowView';
import SkillsView from './components/SkillsView';
import KnowledgeView from './components/KnowledgeView';
import LogsView from './components/LogsView';
import SettingsView from './components/SettingsView';
import PluginsView from './components/PluginsView';
import ConfirmModal from './components/ui/ConfirmModal';
import AboutModal from './components/ui/AboutModal';
import LoginModal from './components/ui/LoginModal';
import UpgradePrompt from './components/ui/UpgradePrompt';

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
}

const CONFIRM_INITIAL: ConfirmState = { open: false, title: '', message: '', onConfirm: () => {} };

export default function App() {
  const { t, i18n } = useTranslation(['common', 'tasks', 'projects']);
  const [view, setViewRaw] = useState<ViewId>('dashboard');
  const [viewKey, setViewKey] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [settings, setSettings] = useState<Settings>({ maxConcurrent: 3, defaultModel: 'sonnet', maxReviewLoops: 5, theme: 'light', locale: 'en', threadMaxFiles: 5, threadMaxLines: 150, postFixLinesPerComment: 50, postFixFilesPerComment: 3, testTimeoutMin: 5, testFixRetries: 3 });
  const [agents, setAgents] = useState<Map<string, ActiveAgent>>(new Map());
  const [confirm, setConfirm] = useState<ConfirmState>(CONFIRM_INITIAL);
  const [pendingEditTaskId, setPendingEditTaskId] = useState<string | null>(null);
  const [pendingDetailTaskId, setPendingDetailTaskId] = useState<string | null>(null);
  const [analyzingProjectId, setAnalyzingProjectId] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  // License & Updates
  const [licensePlan, setLicensePlan] = useState<TierName>('free');
  const [licenseLimits, setLicenseLimits] = useState<LicenseLimits>({ max_projects: 2, max_concurrent: 1, can_configure_agents: false, max_review_loops: 2, can_configure_review_loops: false, models: ['sonnet'], max_knowledge: 20, community_plugins: false, max_parallel_per_project: 1 });
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginMessage, setLoginMessage] = useState<string | undefined>();
  const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);
  const [updateDownloaded, setUpdateDownloaded] = useState<UpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [pluginCompatWarnings, setPluginCompatWarnings] = useState<PluginCompatResult[]>([]);

  const setView = useCallback((v: ViewId) => {
    setViewRaw(v);
    setViewKey((k) => k + 1);
  }, []);

  // Apply theme class to <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  // Load initial data
  useEffect(() => {
    loadData();
    // Non-blocking license validation
    const validateTier = () => {
      ipc.validateLicense().then((result) => {
        setLicensePlan(result.plan as TierName);
        setLicenseLimits(result.limits);
      }).catch(() => {});
    };
    validateTier();
    // Re-validate tier every 24h to catch server-side changes (e.g. order reversal)
    const intervalId = setInterval(validateTier, 24 * 60 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, []);

  // Update event listeners
  useEffect(() => {
    if (!window.electronAPI) return;
    const cleanups = [
      ipc.onUpdateAvailable((info) => {
        setUpdateAvailable(info);
        setUpdateProgress(null);
      }),
      ipc.onUpdateProgress((progress) => setUpdateProgress(progress)),
      ipc.onUpdateDownloaded((info) => {
        setUpdateDownloaded(info);
        setUpdateAvailable(null);
        setUpdateProgress(null);
        // Check plugin compatibility after download
        ipc.checkPluginCompatibility().then((results) => {
          const incompatible = results.filter((r) => !r.compatible);
          if (incompatible.length > 0) setPluginCompatWarnings(incompatible);
        }).catch(() => {});
      }),
      ipc.onUpdateError((err) => {
        setUpdateProgress(null);
        setUpdateError(err);
        console.error('[update] Error:', err);
      }),
      ipc.onPluginCompatWarning((results) => {
        const incompatible = (results as PluginCompatResult[]).filter((r) => !r.compatible);
        if (incompatible.length > 0) setPluginCompatWarnings(incompatible);
      }),
    ];
    return () => cleanups.forEach((c) => c());
  }, []);

  // Set up agent log listener
  useEffect(() => {
    if (!window.electronAPI) return;
    const cleanup = window.electronAPI.onAgentLog((log) => {
      const typedLog = log as { taskId: string; projectName: string; message: string; kind: string };
      loadLogs();
      console.log('[agent]', typedLog.message);
    });
    return cleanup;
  }, []);

  // Set up agent phase update listener
  useEffect(() => {
    if (!window.electronAPI?.onAgentPhaseUpdate) return;
    const cleanup = window.electronAPI.onAgentPhaseUpdate((update) => {
      const typed = update as {
        taskId: string; phase: number; phaseLabel: string; status: string;
        reviewLoop?: number; prNumber?: number; branchName?: string;
        subProgress?: { current: number; total: number; label: string; step?: string };
      };
      setAgents((prev) => {
        const next = new Map(prev);
        if (typed.status === 'completed' && (
          (typed.phase === 4 && typed.phaseLabel === 'shipping') ||
          (typed.phase === 5 && typed.phaseLabel === 'pr_feedback')
        )) {
          // Ship or Fetch & Fix completed → remove active agent
          next.delete(typed.taskId);
        } else if (typed.status === 'failed') {
          next.delete(typed.taskId);
        } else {
          next.set(typed.taskId, {
            taskId: typed.taskId,
            phaseIdx: typed.phase,
            progress: Math.max(0, (typed.phase / 5) * 100),
            reviewLoop: typed.reviewLoop || 0,
            pr: typed.prNumber,
            subProgress: typed.subProgress,
          });
        }
        return next;
      });
      loadTasks();
    });
    return cleanup;
  }, []);

  // Menu navigation listener
  useEffect(() => {
    if (!window.electronAPI?.onMenuNavigate) return;
    const cleanup = window.electronAPI.onMenuNavigate((route) => {
      const viewMap: Record<string, ViewId> = {
        dashboard: 'dashboard', tasks: 'tasks', 'tasks-new': 'tasks',
        projects: 'projects', 'projects-new': 'projects',
        workflow: 'workflow', plugins: 'plugins', skills: 'skills', knowledge: 'knowledge',
        logs: 'logs', settings: 'settings',
      };
      const target = viewMap[route];
      if (target) setView(target);
    });
    return cleanup;
  }, []);

  // About modal listener
  useEffect(() => {
    if (!window.electronAPI?.onShowAbout) return;
    const cleanup = window.electronAPI.onShowAbout(() => setShowAbout(true));
    return cleanup;
  }, []);

  // Periodic refresh
  useEffect(() => {
    const interval = setInterval(() => {
      loadTasks();
      loadLogs();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    await Promise.all([loadProjects(), loadTasks(), loadLogs(), loadSettings()]);
  }

  async function loadProjects() {
    try {
      const data = await ipc.getProjects();
      setProjects(data);
    } catch {
      // IPC not available in browser dev mode
    }
  }

  const RUNNING_STATUSES = new Set([
    'spec_review', 'planning', 'implementing', 'reviewing', 'fixing', 'shipping', 'pr_fixing', 'push_review',
  ]);

  const STATUS_TO_PHASE: Record<string, number> = {
    spec_review: 0, planning: 1, implementing: 2,
    reviewing: 3, fixing: 3, shipping: 4, pr_fixing: 5, push_review: 5,
  };

  async function loadTasks() {
    try {
      const data = await ipc.getTasks();
      setTasks(data);
      // Sync agents map with DB status (survives renderer reload)
      setAgents((prev) => {
        const next = new Map(prev);
        for (const t of data) {
          if (RUNNING_STATUSES.has(t.status) && !next.has(t.id)) {
            const phaseIdx = STATUS_TO_PHASE[t.status] ?? 0;
            next.set(t.id, {
              taskId: t.id,
              phaseIdx,
              progress: Math.max(0, (phaseIdx / 5) * 100),
              reviewLoop: t.reviewCycle || 0,
              pr: t.prNumber,
            });
          }
        }
        // Clean up agents for tasks that reached a terminal or paused state
        for (const [taskId] of next) {
          const t = data.find((tk) => tk.id === taskId);
          if (t && (t.status === 'completed' || t.status === 'failed' || t.status === 'test_fixing')) {
            next.delete(taskId);
          }
        }
        return next;
      });
    } catch {
      // IPC not available
    }
  }

  async function loadLogs() {
    try {
      const data = await ipc.getLogs(100);
      setLogs(data);
    } catch {
      // IPC not available
    }
  }

  async function loadSettings() {
    try {
      const data = await ipc.getSettings();
      setSettings(data);
      // Apply persisted locale
      if (data.locale && data.locale !== i18n.language) {
        i18n.changeLanguage(data.locale);
      }
    } catch {
      // IPC not available
    }
  }

  // Project handlers
  const handleSaveProject = useCallback(async (project: Omit<Project, 'createdAt' | 'updatedAt'>) => {
    try {
      if (project.id && projects.find((p) => p.id === project.id)) {
        await ipc.updateProject(project.id, project);
      } else {
        await ipc.createProject(project);
      }
      await loadProjects();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('PROJECT_LIMIT_REACHED')) {
        setLoginMessage(undefined);
        setLoginModalOpen(true);
      }
    }
  }, [projects]);

  const handleDeleteProject = useCallback((id: string) => {
    const proj = projects.find((p) => p.id === id);
    setConfirm({
      open: true,
      title: t('projects:confirm.deleteTitle', 'Delete project'),
      message: t('projects:confirm.deleteMessage', { name: proj?.name || id, defaultValue: `Project "${proj?.name || id}" and all its references will be deleted. This action cannot be undone.` }),
      confirmLabel: t('button.delete'),
      variant: 'danger',
      onConfirm: async () => {
        setConfirm(CONFIRM_INITIAL);
        try {
          await ipc.deleteProject(id);
        } catch (err) {
          console.error('Failed to delete project:', err);
        } finally {
          await loadProjects();
          await loadTasks();
          await loadLogs();
        }
        ipc.createLog({ projectName: proj?.name, message: `${t('projects:log.deleted', { name: proj?.name, defaultValue: `Project "${proj?.name}" deleted` })}`, kind: 'info' }).catch(() => {});
      },
    });
  }, [projects, t]);

  const handleUpdateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    try {
      await ipc.updateProject(id, updates);
      await loadProjects();
    } catch {
      // error
    }
  }, []);

  const handleAnalyzeRepo = useCallback(async (projectId: string) => {
    setAnalyzingProjectId(projectId);
    try {
      await ipc.analyzeRepo(projectId);
      await loadProjects();
    } catch (err) {
      console.error('Failed to analyze repo:', err);
    } finally {
      setAnalyzingProjectId(null);
    }
  }, []);

  // Task handlers
  const handleCreateTask = useCallback(async (data: Partial<Task>) => {
    try {
      await ipc.createTask(data);
      await loadTasks();
    } catch {
      // error
    }
  }, []);

  const handleUpdateTask = useCallback(async (id: string, data: Partial<Task>) => {
    try {
      const prev = tasks.find((t) => t.id === id);
      await ipc.updateTask(id, data);
      // Log status changes
      if (prev && data.status && data.status !== prev.status) {
        const label = data.status === 'queued'
          ? t('tasks:log.requeued', { defaultValue: 'Task re-queued (edited)' })
          : `Status: ${prev.status} -> ${data.status}`;
        await ipc.createLog({ taskId: id, projectName: prev.projectName, message: `${label}: ${prev.title}`, kind: 'info' });
        await loadLogs();
      } else if (prev && !data.status) {
        await ipc.createLog({ taskId: id, projectName: prev.projectName, message: `${t('tasks:log.edited', { defaultValue: 'Task edited' })}: ${prev.title}`, kind: 'info' });
        await loadLogs();
      }
      await loadTasks();
    } catch {
      // error
    }
  }, [tasks, t]);

  const handleDeleteTask = useCallback((id: string) => {
    const tk = tasks.find((t) => t.id === id);
    setConfirm({
      open: true,
      title: t('tasks:confirm.deleteTitle', 'Delete task'),
      message: t('tasks:confirm.deleteMessage', { title: tk?.title || id, defaultValue: `Task "${tk?.title || id}" will be deleted. Associated agent logs and runs are preserved. This action cannot be undone.` }),
      confirmLabel: t('button.delete'),
      variant: 'danger',
      onConfirm: async () => {
        setConfirm(CONFIRM_INITIAL);
        try {
          await ipc.deleteTask(id);
        } catch (err) {
          console.error('Failed to delete task:', err);
        } finally {
          await loadTasks();
          await loadLogs();
        }
        ipc.createLog({ projectName: tk?.projectName, message: `${t('tasks:log.deleted', { defaultValue: 'Task deleted' })}: ${tk?.title}`, kind: 'info' }).catch(() => {});
      },
    });
  }, [tasks, t]);

  const handleStartTask = useCallback(async (task: Task) => {
    try {
      // Add to active agents for UI tracking (backend orchestrates phases)
      setAgents((prev) => {
        const next = new Map(prev);
        next.set(task.id, {
          taskId: task.id,
          phaseIdx: 0,
          progress: 0,
          reviewLoop: 0,
        });
        return next;
      });
      await ipc.runAgent(task.id);
      await loadTasks();
    } catch {
      // error
    }
  }, []);

  const handleStopTask = useCallback(async (task: Task) => {
    try {
      await ipc.stopAgent(task.id);
      setAgents((prev) => {
        const next = new Map(prev);
        next.delete(task.id);
        return next;
      });
      await loadTasks();
    } catch {
      // error
    }
  }, []);

  const handleFetchAndFix = useCallback(async (task: Task) => {
    try {
      await ipc.updateTask(task.id, { status: 'pr_fixing' });
      await ipc.runAgent(task.id, 'fetch_fix');
      await loadTasks();
    } catch {
      // error
    }
  }, []);

  const handleContinueSpec = useCallback(async (task: Task, action: 'accept' | 'edit', editedSpec?: string) => {
    try {
      await ipc.continueSpec(task.id, action, editedSpec);
      // Add to active agents since workflow resumes
      setAgents((prev) => {
        const next = new Map(prev);
        next.set(task.id, {
          taskId: task.id,
          phaseIdx: 0,
          progress: 0,
          reviewLoop: 0,
        });
        return next;
      });
      await loadTasks();
    } catch {
      // error
    }
  }, []);

  const handleContinuePlan = useCallback(async (task: Task, action: 'approve' | 'replan') => {
    try {
      await ipc.continuePlan(task.id, action);
      if (action === 'approve') {
        // Add to active agents since workflow resumes
        setAgents((prev) => {
          const next = new Map(prev);
          next.set(task.id, {
            taskId: task.id,
            phaseIdx: 2,
            progress: 40,
            reviewLoop: 0,
          });
          return next;
        });
      }
      await loadTasks();
    } catch {
      // error
    }
  }, []);

  const handleApprovePush = useCallback(async (task: Task) => {
    await ipc.continuePush(task.id, 'approve');
  }, []);

  const handleRejectPush = useCallback(async (task: Task) => {
    await ipc.continuePush(task.id, 'reject');
    setAgents((prev) => { const next = new Map(prev); next.delete(task.id); return next; });
    await loadTasks();
  }, []);

  const handleRevisePush = useCallback(async (task: Task, prompt: string) => {
    await ipc.continuePush(task.id, 'revise', prompt);
  }, []);

  const handleFixTests = useCallback(async (task: Task) => {
    try {
      setAgents((prev) => {
        const next = new Map(prev);
        next.set(task.id, {
          taskId: task.id,
          phaseIdx: 5,
          progress: 80,
          reviewLoop: task.reviewCycle || 0,
          pr: task.prNumber,
        });
        return next;
      });
      await ipc.fixTests(task.id);
      await loadTasks();
    } catch {
      // error
    }
  }, []);

  const handleApproveTask = useCallback(async (task: Task) => {
    try {
      await ipc.updateTask(task.id, { status: 'completed' });
      await ipc.createLog({ projectName: task.projectName, message: `PR #${task.prNumber} ${t('tasks:log.approved', { defaultValue: 'approved' })}`, kind: 'ok' });
      await loadTasks();
      await loadLogs();
    } catch {
      // error
    }
  }, [t]);

  // Auth handlers
  const handleLogin = useCallback(async (username: string, password: string) => {
    setLoginLoading(true);
    setLoginError(null);
    try {
      const result = await ipc.login(username, password);
      setLicensePlan(result.plan);
      setLicenseLimits(result.limits);
      setLoginModalOpen(false);
      setLoginMessage(undefined);
      await loadSettings();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  }, []);

  const handleRegister = useCallback(async (username: string, email: string, password: string) => {
    setLoginLoading(true);
    setLoginError(null);
    try {
      const result = await ipc.register(username, email, password);
      setLicensePlan(result.plan);
      setLicenseLimits(result.limits);
      setLoginModalOpen(false);
      setLoginMessage(undefined);
      await loadSettings();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoginLoading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await ipc.logout();
    setLicensePlan('free');
    setLicenseLimits({ max_projects: 2, max_concurrent: 1, can_configure_agents: false, max_review_loops: 2, can_configure_review_loops: false, models: ['sonnet'], max_knowledge: 20, community_plugins: false, max_parallel_per_project: 1 });
    await loadSettings();
  }, []);

  const handleUpgrade = useCallback(async () => {
    if (licensePlan === 'free') {
      setLoginModalOpen(true);
    } else if (licensePlan === 'registered') {
      const url = await ipc.getPremiumUrl();
      await ipc.openExternal(url);
    }
  }, [licensePlan]);

  const handleRefreshAccount = useCallback(async () => {
    try {
      const result = await ipc.validateLicense();
      setLicensePlan(result.plan as TierName);
      setLicenseLimits(result.limits);
      await loadSettings();
    } catch {
      // offline — keep cached tier
    }
  }, []);

  const handleDownloadUpdate = useCallback(async () => {
    try {
      setUpdateError(null);
      setUpdateProgress({ percent: 0, bytesPerSecond: 0, total: 0, transferred: 0 });
      await ipc.downloadUpdate();
    } catch {
      setUpdateProgress(null);
    }
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    try {
      await ipc.installUpdate();
    } catch (err) {
      setUpdateError(`Install failed: ${(err as Error).message}`);
    }
  }, []);

  const handleSkipUpdate = useCallback(async (version: string) => {
    try {
      await ipc.skipUpdate(version);
      setUpdateAvailable(null);
    } catch { /* */ }
  }, []);

  // Settings handler
  const handleUpdateSetting = useCallback(async (key: string, value: string) => {
    try {
      await ipc.updateSetting(key, value);
      // Apply locale change immediately
      if (key === 'locale') {
        i18n.changeLanguage(value);
      }
      await loadSettings();
    } catch {
      // error
    }
  }, [i18n]);

  const counts = {
    tasks: tasks.filter((t) => !['completed', 'failed'].includes(t.status)).length,
    projects: projects.length,
  };

  const views: Record<ViewId, React.ReactNode> = {
    dashboard: (
      <Dashboard
        tasks={tasks}
        logs={logs}
        settings={settings}
        agents={agents}
        updateAvailable={updateAvailable}
        updateProgress={updateProgress}
        updateDownloaded={updateDownloaded}
        updateError={updateError}
        licenseLimits={licenseLimits}
        pluginCompatWarnings={pluginCompatWarnings}
        onDownloadUpdate={handleDownloadUpdate}
        onInstallUpdate={handleInstallUpdate}
        onSkipUpdate={handleSkipUpdate}
        onRefineSpec={(task) => {
          setPendingEditTaskId(task.id);
          setView('tasks');
        }}
        onContinueSpec={(task) => handleContinueSpec(task, 'accept')}
        onContinuePlan={handleContinuePlan}
        onFetchAndFix={handleFetchAndFix}
        onApproveTask={handleApproveTask}
        onNavigateToTask={(task) => {
          setPendingDetailTaskId(task.id);
          setView('tasks');
        }}
      />
    ),
    tasks: (
      <TasksView
        key={viewKey}
        tasks={tasks}
        projects={projects}
        logs={logs}
        agents={agents}
        settings={settings}
        licenseLimits={licenseLimits}
        pendingEditTaskId={pendingEditTaskId}
        pendingDetailTaskId={pendingDetailTaskId}
        onClearPendingEdit={() => setPendingEditTaskId(null)}
        onClearPendingDetail={() => setPendingDetailTaskId(null)}
        onCreateTask={handleCreateTask}
        onUpdateTask={handleUpdateTask}
        onDeleteTask={handleDeleteTask}
        onStartTask={handleStartTask}
        onStopTask={handleStopTask}
        onContinueSpec={handleContinueSpec}
        onContinuePlan={handleContinuePlan}
        onFetchAndFix={handleFetchAndFix}
        onApproveTask={handleApproveTask}
        onApprovePush={handleApprovePush}
        onRejectPush={handleRejectPush}
        onRevisePush={handleRevisePush}
        onFixTests={handleFixTests}
      />
    ),
    projects: <ProjectsView key={viewKey} projects={projects} onSave={handleSaveProject} onDelete={handleDeleteProject} onAnalyzeRepo={handleAnalyzeRepo} analyzingProjectId={analyzingProjectId} />,
    workflow: <WorkflowView />,
    plugins: <PluginsView licenseLimits={licenseLimits} onOpenLogin={() => setLoginModalOpen(true)} />,
    skills: <SkillsView projects={projects} onUpdateProject={handleUpdateProject} />,
    knowledge: <KnowledgeView projects={projects} />,
    logs: <LogsView projects={projects} />,
    settings: <SettingsView settings={settings} onUpdate={handleUpdateSetting} onReloadSettings={loadSettings} licensePlan={licensePlan} licenseLimits={licenseLimits} onOpenLogin={() => setLoginModalOpen(true)} onLogout={handleLogout} onUpgrade={handleUpgrade} onRefreshAccount={handleRefreshAccount} />,
  };

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 overflow-hidden">
      <Sidebar view={view} setView={setView} counts={counts} licensePlan={licensePlan} onUpgrade={handleUpgrade} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Draggable title bar region for main content area */}
        <div className="h-8 flex-shrink-0 titlebar-drag" />
        <main className="flex-1 overflow-y-auto px-8 pb-8">{views[view]}</main>
      </div>
      <LoginModal
        open={loginModalOpen}
        onClose={() => { setLoginModalOpen(false); setLoginError(null); }}
        onLogin={handleLogin}
        onRegister={handleRegister}
        loading={loginLoading}
        error={loginError}
        message={loginMessage}
      />
      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
      <ConfirmModal
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.confirmLabel}
        variant={confirm.variant}
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm(CONFIRM_INITIAL)}
      />
    </div>
  );
}
