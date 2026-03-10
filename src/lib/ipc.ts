import type {
  Project,
  Task,
  Plugin,
  CatalogPlugin,
  KnowledgeEntry,
  Settings,
  Log,
  HealthStatus,
  InstalledAgent,
  AgentLogMessage,
  AgentPhaseUpdate,
  LicenseLimits,
  AuthResult,
  UpdateInfo,
  UpdateProgress,
  PluginCompatResult,
  PmWorkItem,
  PluginTaskField,
  NotificationsConfig,
  WorktreeInfo,
  ConflictFile,
  WorktreeDiff,
  MonorepoPackage,
} from './types';

const api = () => window.electronAPI;

// ── Projects ──
export const getProjects = (): Promise<Project[]> => api().getProjects();
export const createProject = (project: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<Project> =>
  api().createProject(project);
export const updateProject = (id: string, updates: Partial<Project>): Promise<Project> =>
  api().updateProject(id, updates);
export const deleteProject = (id: string): Promise<void> => api().deleteProject(id);

// ── Tasks ──
export const getTasks = (projectId?: string): Promise<Task[]> => api().getTasks(projectId);
export const getTask = (id: string): Promise<Task> => api().getTask(id);
export const createTask = (task: Partial<Task>): Promise<Task> => api().createTask(task);
export const updateTask = (id: string, updates: Partial<Task>): Promise<Task> =>
  api().updateTask(id, updates);
export const deleteTask = (id: string): Promise<void> => api().deleteTask(id);

// ── Task Subtasks ──
export const completeSubtask = (taskId: string, pluginId: string, subtaskId: string, completed: boolean) =>
  api().completeSubtask(taskId, pluginId, subtaskId, completed);
export const refreshSubtasks = (taskId: string) => api().refreshSubtasks(taskId);
export const completeCriterion = (taskId: string, pluginId: string, criterionId: string, completed: boolean) =>
  api().completeCriterion(taskId, pluginId, criterionId, completed);

// ── Agent ──
export const runAgent = (taskId: string, phase?: string): Promise<void> =>
  api().runAgent(taskId, phase);
export const stopAgent = (taskId: string): Promise<void> => api().stopAgent(taskId);
export const healthCheck = (): Promise<HealthStatus> => api().healthCheck();
export const getInstalledAgents = (): Promise<InstalledAgent[]> => api().getInstalledAgents();

export const onAgentLog = (callback: (log: AgentLogMessage) => void): (() => void) =>
  api().onAgentLog(callback);

export const onAgentPhaseUpdate = (callback: (update: AgentPhaseUpdate) => void): (() => void) =>
  api().onAgentPhaseUpdate(callback);

export const continueSpec = (taskId: string, action: 'accept' | 'edit', editedSpec?: string): Promise<void> =>
  api().continueSpec(taskId, action, editedSpec);

export const continuePlan = (taskId: string, action: 'approve' | 'replan'): Promise<void> =>
  api().continuePlan(taskId, action);

export const continuePush = (taskId: string, action: 'approve' | 'reject' | 'revise', prompt?: string): Promise<void> =>
  api().continuePush(taskId, action, prompt);

export const fixTests = (taskId: string): Promise<void> => api().fixTests(taskId);

export const analyzeRepo = (projectId: string): Promise<string> => api().analyzeRepo(projectId);

export const refineWithAI = (context: {
  field: 'description' | 'acceptanceCriteria';
  title: string;
  description: string;
  acceptanceCriteria: string;
  projectId: string;
}): Promise<string> => api().refineWithAI(context);

// ── GitHub ──
export const fetchPRComments = (projectPath: string, prNumber: number): Promise<unknown> =>
  api().fetchPRComments(projectPath, prNumber);

// ── Skills ──
export const readGlobalSkills = (): Promise<string[]> => api().readGlobalSkills();
export const writeGlobalSkills = (skills: string[]): Promise<void> =>
  api().writeGlobalSkills(skills);
export const readProjectSkills = (projectPath: string): Promise<string[]> =>
  api().readProjectSkills(projectPath);
export const writeProjectSkills = (projectPath: string, skills: string[]): Promise<void> =>
  api().writeProjectSkills(projectPath, skills);

// ── Knowledge ──
export const getKnowledgeEntries = (projectId?: string): Promise<KnowledgeEntry[]> =>
  api().getKnowledgeEntries(projectId);
export const createKnowledgeEntry = (entry: Partial<KnowledgeEntry>): Promise<KnowledgeEntry> =>
  api().createKnowledgeEntry(entry);
export const updateKnowledgeEntry = (id: string, updates: Partial<KnowledgeEntry>): Promise<void> =>
  api().updateKnowledgeEntry(id, updates);
export const deleteKnowledgeEntry = (id: string): Promise<void> =>
  api().deleteKnowledgeEntry(id);

// ── Settings ──
export const getSettings = (): Promise<Settings> => api().getSettings();
export const updateSetting = (key: string, value: string): Promise<void> =>
  api().updateSetting(key, value);

// ── Logs ──
export const getLogs = (limit?: number, projectName?: string): Promise<Log[]> =>
  api().getLogs(limit, projectName);
export const createLog = (log: Partial<Log>): Promise<void> => api().createLog(log);
export const clearLogs = (): Promise<void> => api().clearLogs();

// ── Plugins ──
export const getPlugins = (): Promise<Plugin[]> => api().getPlugins();
export const getPlugin = (id: string): Promise<Plugin> => api().getPlugin(id);
export const installPlugin = (id: string, config: Record<string, string>): Promise<void> =>
  api().installPlugin(id, config);
export const uninstallPlugin = (id: string): Promise<void> => api().uninstallPlugin(id);
export const updatePluginConfig = (id: string, config: Record<string, string>): Promise<void> =>
  api().updatePluginConfig(id, config);
export const getProjectPlugins = (projectId: string): Promise<Plugin[]> =>
  api().getProjectPlugins(projectId);
export const activatePluginForProject = (projectId: string, pluginId: string, capability: string): Promise<void> =>
  api().activatePluginForProject(projectId, pluginId, capability);
export const deactivatePluginForProject = (projectId: string, capability: string): Promise<void> =>
  api().deactivatePluginForProject(projectId, capability);
export const checkPluginConflicts = (projectId: string, pluginId: string): Promise<string[]> =>
  api().checkPluginConflicts(projectId, pluginId);
export const executePluginAction = (pluginId: string, actionId: string, context: Record<string, string>): Promise<unknown> =>
  api().executePluginAction(pluginId, actionId, context);
export const getPluginCatalog = (forceRefresh?: boolean): Promise<CatalogPlugin[]> =>
  api().getPluginCatalog(forceRefresh);
export const installCatalogPlugin = (pluginId: string, config: Record<string, string>): Promise<void> =>
  api().installCatalogPlugin(pluginId, config);
export const previewLocalPlugin = (folderPath: string) =>
  api().previewLocalPlugin(folderPath);
export const installPluginFromDisk = (folderPath: string, config: Record<string, string>): Promise<void> =>
  api().installPluginFromDisk(folderPath, config);

// ── Auth / License ──
export const login = (username: string, password: string): Promise<AuthResult> =>
  api().login(username, password);
export const register = (username: string, email: string, password: string): Promise<AuthResult> =>
  api().register(username, email, password);
export const validateLicense = (): Promise<AuthResult> =>
  api().validateLicense();
export const logout = (): Promise<void> => api().logout();
export const getLicenseLimits = (): Promise<LicenseLimits> => api().getLicenseLimits();

// ── Updates ──
export const checkForUpdate = (): Promise<void> => api().checkForUpdate();
export const downloadUpdate = (): Promise<void> => api().downloadUpdate();
export const installUpdate = (): Promise<void> => api().installUpdate();
export const skipUpdate = (version: string): Promise<void> => api().skipUpdate(version);
export const onUpdateAvailable = (cb: (info: UpdateInfo) => void): (() => void) =>
  api().onUpdateAvailable(cb);
export const onUpdateProgress = (cb: (progress: UpdateProgress) => void): (() => void) =>
  api().onUpdateProgress(cb);
export const onUpdateDownloaded = (cb: (info: UpdateInfo) => void): (() => void) =>
  api().onUpdateDownloaded(cb);
export const onUpdateError = (cb: (error: string) => void): (() => void) =>
  api().onUpdateError(cb);

// ── Plugin PM work items ──
export const listPmWorkItems = (pluginId: string): Promise<PmWorkItem[]> =>
  api().listPmWorkItems(pluginId);

// ── Plugin dynamic config options ──
export const fetchPluginConfigOptions = (
  server: string,
  tool: string,
  labelField: string,
  valueField: string,
  args?: Record<string, string>
): Promise<{ label: string; value: string }[]> =>
  api().fetchPluginConfigOptions(server, tool, labelField, valueField, args);

// ── Plugin task fields ──
export const getTaskFieldsForProject = (projectId: string): Promise<PluginTaskField[]> =>
  api().getTaskFieldsForProject(projectId);
export const executePluginOperation = (pluginId: string, operationId: string, args?: Record<string, string>): Promise<unknown> =>
  api().executePluginOperation(pluginId, operationId, args);

// ── Plugin compatibility ──
export const checkPluginCompatibility = (): Promise<PluginCompatResult[]> =>
  api().checkPluginCompatibility();
export const onPluginCompatWarning = (cb: (results: PluginCompatResult[]) => void): (() => void) =>
  api().onPluginCompatWarning(cb);

// ── Notifications ──
export const getNotificationsConfig = (): Promise<NotificationsConfig> => api().getNotificationsConfig();
export const updateNotificationsConfig = (config: NotificationsConfig): Promise<void> => api().updateNotificationsConfig(config);

// ── Worktrees ──
export const listWorktrees = (): Promise<WorktreeInfo[]> => api().listWorktrees();
export const detectWorktreeConflicts = (projectId: string): Promise<ConflictFile[]> =>
  api().detectWorktreeConflicts(projectId);
export const mergeWorktreeBranch = (taskId: string): Promise<{ success: boolean; message: string }> =>
  api().mergeWorktreeBranch(taskId);
export const removeWorktreeForTask = (taskId: string): Promise<void> =>
  api().removeWorktreeForTask(taskId);
export const getWorktreeDiff = (taskId: string): Promise<WorktreeDiff | null> =>
  api().getWorktreeDiff(taskId);
export const getMonorepoPackages = (projectId: string): Promise<MonorepoPackage[]> =>
  api().getMonorepoPackages(projectId);

// ── App info ──
export const getAppVersion = (): Promise<string> => api().getAppVersion();

// ── Dialog ──
export const selectFolder = (): Promise<string | null> => api().selectFolder();
export const selectImages = (): Promise<string[]> => api().selectImages();
export const getGitRemote = (folderPath: string): Promise<string | null> => api().getGitRemote(folderPath);
export const openExternal = (url: string): Promise<void> => api().openExternal(url);
export const getPremiumUrl = (): Promise<string> => api().getPremiumUrl();
