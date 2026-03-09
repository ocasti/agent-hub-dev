import { contextBridge, ipcRenderer } from 'electron';

/**
 * Strip Electron's "Error invoking remote method 'channel': " prefix from IPC errors.
 */
function cleanIpcError(err: unknown): never {
  if (err instanceof Error) {
    const cleaned = err.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
    throw new Error(cleaned);
  }
  throw err;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Projects
  getProjects: () => ipcRenderer.invoke('projects:getAll'),
  createProject: (project: unknown) => ipcRenderer.invoke('projects:create', project),
  updateProject: (id: string, updates: unknown) => ipcRenderer.invoke('projects:update', id, updates),
  deleteProject: (id: string) => ipcRenderer.invoke('projects:delete', id),

  // Tasks
  getTasks: (projectId?: string) => ipcRenderer.invoke('tasks:getAll', projectId),
  getTask: (id: string) => ipcRenderer.invoke('tasks:get', id),
  createTask: (task: unknown) => ipcRenderer.invoke('tasks:create', task),
  updateTask: (id: string, updates: unknown) => ipcRenderer.invoke('tasks:update', id, updates),
  deleteTask: (id: string) => ipcRenderer.invoke('tasks:delete', id),

  // Agent
  runAgent: (taskId: string, phase?: string) => ipcRenderer.invoke('agent:run', taskId, phase),
  stopAgent: (taskId: string) => ipcRenderer.invoke('agent:stop', taskId),
  healthCheck: () => ipcRenderer.invoke('agent:healthCheck'),

  // Agent logs listener
  onAgentLog: (callback: (log: unknown) => void) => {
    const handler = (_event: unknown, log: unknown) => callback(log);
    ipcRenderer.on('agent:log', handler);
    return () => ipcRenderer.removeListener('agent:log', handler);
  },

  // Agent phase update listener
  onAgentPhaseUpdate: (callback: (update: unknown) => void) => {
    const handler = (_event: unknown, update: unknown) => callback(update);
    ipcRenderer.on('agent:phaseUpdate', handler);
    return () => ipcRenderer.removeListener('agent:phaseUpdate', handler);
  },

  // Continue from spec feedback
  continueSpec: (taskId: string, action: string, editedSpec?: string) =>
    ipcRenderer.invoke('agent:continueSpec', taskId, action, editedSpec),

  // Continue from plan review
  continuePlan: (taskId: string, action: string) =>
    ipcRenderer.invoke('agent:continuePlan', taskId, action),

  // Continue from push review
  continuePush: (taskId: string, action: string, prompt?: string) =>
    ipcRenderer.invoke('agent:continuePush', taskId, action, prompt),

  // Fix tests (resume from test_fixing state)
  fixTests: (taskId: string) => ipcRenderer.invoke('agent:fixTests', taskId),

  // Analyze repo
  analyzeRepo: (projectId: string) => ipcRenderer.invoke('agent:analyzeRepo', projectId),

  // Refine field with AI
  refineWithAI: (context: {
    field: string; title: string; description: string;
    acceptanceCriteria: string; projectId: string;
  }) => ipcRenderer.invoke('agent:refineWithAI', context),

  // GitHub
  fetchPRComments: (projectPath: string, prNumber: number) =>
    ipcRenderer.invoke('github:fetchPRComments', projectPath, prNumber),

  // Skills
  readGlobalSkills: () => ipcRenderer.invoke('skills:readGlobal'),
  writeGlobalSkills: (skills: string[]) => ipcRenderer.invoke('skills:writeGlobal', skills),
  readProjectSkills: (projectPath: string) => ipcRenderer.invoke('skills:readProject', projectPath),
  writeProjectSkills: (projectPath: string, skills: string[]) =>
    ipcRenderer.invoke('skills:writeProject', projectPath, skills),

  // Knowledge
  getKnowledgeEntries: (projectId?: string) => ipcRenderer.invoke('knowledge:getAll', projectId),
  createKnowledgeEntry: (entry: unknown) => ipcRenderer.invoke('knowledge:create', entry),
  updateKnowledgeEntry: (id: string, updates: unknown) => ipcRenderer.invoke('knowledge:update', id, updates),
  deleteKnowledgeEntry: (id: string) => ipcRenderer.invoke('knowledge:delete', id),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  updateSetting: (key: string, value: string) => {
    const result = ipcRenderer.invoke('settings:update', key, value);
    if (key === 'locale') {
      ipcRenderer.send('settings:locale-changed', value);
    }
    return result;
  },

  // Logs
  getLogs: (limit?: number, projectName?: string) => ipcRenderer.invoke('logs:getAll', limit, projectName),
  createLog: (log: unknown) => ipcRenderer.invoke('logs:create', log),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),

  // Plugins
  getPlugins: () => ipcRenderer.invoke('plugins:list'),
  getPlugin: (id: string) => ipcRenderer.invoke('plugins:get', id),
  installPlugin: (id: string, config: Record<string, string>) =>
    ipcRenderer.invoke('plugins:install', id, config),
  uninstallPlugin: (id: string) => ipcRenderer.invoke('plugins:uninstall', id),
  updatePluginConfig: (id: string, config: Record<string, string>) =>
    ipcRenderer.invoke('plugins:updateConfig', id, config),
  getProjectPlugins: (projectId: string) =>
    ipcRenderer.invoke('plugins:getProjectPlugins', projectId),
  activatePluginForProject: (projectId: string, pluginId: string, capability: string) =>
    ipcRenderer.invoke('plugins:activateForProject', projectId, pluginId, capability),
  deactivatePluginForProject: (projectId: string, capability: string) =>
    ipcRenderer.invoke('plugins:deactivateForProject', projectId, capability),
  checkPluginConflicts: (projectId: string, pluginId: string) =>
    ipcRenderer.invoke('plugins:checkConflicts', projectId, pluginId),
  executePluginAction: (pluginId: string, actionId: string, context: Record<string, string>) =>
    ipcRenderer.invoke('plugins:executeAction', pluginId, actionId, context),
  getPluginCatalog: (forceRefresh?: boolean) =>
    ipcRenderer.invoke('plugins:catalog', forceRefresh),
  installCatalogPlugin: (pluginId: string, config: Record<string, string>) =>
    ipcRenderer.invoke('plugins:installFromCatalog', pluginId, config),
  previewLocalPlugin: (folderPath: string) =>
    ipcRenderer.invoke('plugins:previewLocalPlugin', folderPath),
  installPluginFromDisk: (folderPath: string, config: Record<string, string>) =>
    ipcRenderer.invoke('plugins:installFromDisk', folderPath, config),

  // License / Auth
  login: (username: string, password: string) =>
    ipcRenderer.invoke('license:login', username, password).catch(cleanIpcError),
  register: (username: string, email: string, password: string) =>
    ipcRenderer.invoke('license:register', username, email, password).catch(cleanIpcError),
  validateLicense: () => ipcRenderer.invoke('license:validate'),
  logout: () => ipcRenderer.invoke('license:logout'),
  getLicenseLimits: () => ipcRenderer.invoke('license:getLimits'),

  // Updates
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  skipUpdate: (version: string) => ipcRenderer.invoke('update:skip', version),
  onUpdateAvailable: (callback: (info: unknown) => void) => {
    const handler = (_event: unknown, info: unknown) => callback(info);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  onUpdateProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: unknown, progress: unknown) => callback(progress);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
  onUpdateDownloaded: (callback: (info: unknown) => void) => {
    const handler = (_event: unknown, info: unknown) => callback(info);
    ipcRenderer.on('update:downloaded', handler);
    return () => ipcRenderer.removeListener('update:downloaded', handler);
  },
  onUpdateError: (callback: (error: unknown) => void) => {
    const handler = (_event: unknown, error: unknown) => callback(error);
    ipcRenderer.on('update:error', handler);
    return () => ipcRenderer.removeListener('update:error', handler);
  },

  // Plugin dynamic config options from MCP
  fetchPluginConfigOptions: (server: string, tool: string, labelField: string, valueField: string, args?: Record<string, string>) =>
    ipcRenderer.invoke('plugins:fetchConfigOptions', server, tool, labelField, valueField, args),
  listPmWorkItems: (pluginId: string) =>
    ipcRenderer.invoke('plugins:listWorkItems', pluginId),

  // Plugin task fields
  getTaskFieldsForProject: (projectId: string) =>
    ipcRenderer.invoke('plugins:getTaskFields', projectId),
  executePluginOperation: (pluginId: string, operationId: string, args?: Record<string, string>) =>
    ipcRenderer.invoke('plugins:executeOperation', pluginId, operationId, args),

  // Plugin compatibility
  checkPluginCompatibility: () => ipcRenderer.invoke('plugins:checkCompatibility'),
  onPluginCompatWarning: (callback: (results: unknown) => void) => {
    const handler = (_event: unknown, results: unknown) => callback(results);
    ipcRenderer.on('plugins:compatibility-warning', handler);
    return () => ipcRenderer.removeListener('plugins:compatibility-warning', handler);
  },

  // Notifications
  getNotificationsConfig: () => ipcRenderer.invoke('notifications:getConfig'),
  updateNotificationsConfig: (config: unknown) => ipcRenderer.invoke('notifications:updateConfig', config),

  // Dialog
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  selectImages: () => ipcRenderer.invoke('dialog:selectImages'),
  getGitRemote: (folderPath: string) => ipcRenderer.invoke('dialog:getGitRemote', folderPath),
  openExternal: (url: string) => ipcRenderer.invoke('dialog:openExternal', url),
  getPremiumUrl: () => ipcRenderer.invoke('dialog:getPremiumUrl'),

  // Menu events
  onMenuNavigate: (callback: (route: string) => void) => {
    const channels = [
      'menu:navigate:dashboard', 'menu:navigate:tasks', 'menu:navigate:tasks-new',
      'menu:navigate:projects', 'menu:navigate:projects-new', 'menu:navigate:workflow',
      'menu:navigate:skills', 'menu:navigate:knowledge', 'menu:navigate:logs',
      'menu:navigate:settings',
    ];
    const handlers = channels.map((ch) => {
      const handler = () => callback(ch.replace('menu:navigate:', ''));
      ipcRenderer.on(ch, handler);
      return { ch, handler };
    });
    return () => handlers.forEach(({ ch, handler }) => ipcRenderer.removeListener(ch, handler));
  },
  onShowAbout: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu:show-about', handler);
    return () => ipcRenderer.removeListener('menu:show-about', handler);
  },
});
