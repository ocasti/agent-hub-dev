export interface Project {
  id: string;
  name: string;
  path: string;
  repo?: string;
  description: string;
  optionalSkills: string[];
  testCommand: string;
  codeHosting?: string;
  pluginPm?: string;
  pluginPmConfig?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CriterionStatus {
  index: number;
  met: boolean;
  note?: string;
}

export type TaskStatus =
  | 'queued'
  | 'spec_review'
  | 'spec_feedback'
  | 'planning'
  | 'plan_review'
  | 'implementing'
  | 'reviewing'
  | 'fixing'
  | 'shipping'
  | 'pr_feedback'
  | 'pr_fixing'
  | 'push_review'
  | 'test_fixing'
  | 'completed'
  | 'failed';

export interface Task {
  id: string;
  projectId: string;
  projectName: string;
  projectPath?: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  images: { url: string }[];
  model: 'sonnet' | 'opus';
  status: TaskStatus;
  prNumber?: number;
  reviewCycle: number;
  specSuggestions?: string[];
  planSummary?: string;
  lastPhase?: number;
  branchName?: string;
  criteriaStatus: CriterionStatus[];
  pmWorkItemId?: string;
  pmWorkItemUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  taskId: string;
  phase: string;
  startedAt: string;
  finishedAt?: string;
  result?: string;
  output?: string;
  errorOutput?: string;
}

export interface Log {
  id: number;
  taskId?: string;
  projectName?: string;
  message: string;
  kind: 'step' | 'ok' | 'error' | 'info';
  createdAt: string;
}

export interface KnowledgeEntry {
  id: string;
  projectId?: string;
  category: 'security' | 'testing' | 'architecture' | 'standards' | 'performance';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  sourceTask?: string;
  sourcePr?: number;
  codeExample?: string;
  antiPattern?: string;
  tags: string[];
  timesApplied: number;
  createdAt: string;
}

export interface ReviewPattern {
  id: string;
  knowledgeId: string;
  taskId: string;
  reviewer: string;
  issueFound: string;
  fixApplied: string;
  phase?: string;
  autoFixable: boolean;
  createdAt: string;
}

export interface LicenseLimits {
  max_projects: number;
  max_concurrent: number;
  models: string[];
  max_knowledge: number;
  community_plugins: boolean;
}

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
}

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  total: number;
  transferred: number;
}

export interface PluginCompatResult {
  pluginId: string;
  name: string;
  compatible: boolean;
  reason?: string;
}

export interface Settings {
  maxConcurrent: number;
  defaultModel: 'sonnet' | 'opus';
  maxReviewLoops: number;
  theme: 'light' | 'dark';
  locale: 'en' | 'es';
  threadMaxFiles: number;
  threadMaxLines: number;
  postFixLinesPerComment: number;
  postFixFilesPerComment: number;
  testTimeoutMin: number;
  testFixRetries: number;
  // License
  licenseKey?: string;
  licenseStatus?: string;
  licensePlan?: 'free' | 'pro';
  licenseEmail?: string;
  licenseLimits?: LicenseLimits;
  // Updates
  updateAutoCheck?: boolean;
  updateLastCheck?: string;
  updateSkippedVersion?: string;
}

export interface HealthStatus {
  claudeInstalled: boolean;
  claudeVersion?: string;
  ghInstalled: boolean;
  ghVersion?: string;
  gitInstalled: boolean;
  specifyInstalled: boolean;
}

export interface AgentLogMessage {
  taskId: string;
  projectName: string;
  message: string;
  kind: 'step' | 'ok' | 'error' | 'info';
}

export interface AgentPhaseUpdate {
  taskId: string;
  phase: number;       // 0-5
  phaseLabel: string;  // "spec_review", "planning", etc.
  status: 'started' | 'completed' | 'failed' | 'paused';
  reviewLoop?: number;
  prNumber?: number;
  branchName?: string;
  specSuggestions?: string[];
  planSummary?: string;
}

export interface ActiveAgent {
  taskId: string;
  phaseIdx: number;
  progress: number;
  reviewLoop: number;
  pr?: number;
  currentPhase?: WorkflowPhase;
  subProgress?: { current: number; total: number; label: string; step?: string };
}

export interface WorkflowPhase {
  id: string;
  label: string;
  phase: number;
  skill: string;
  icon: string;
}

export interface SkillInfo {
  id: string;
  name: string;
  author?: string;
  repo?: string;
  category: string;
  desc: string;
  locked?: boolean;
  tags?: string[];
  install?: string;
}

// ── Plugin types ──

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  capabilities: string[];
  level: 1 | 2;
  enabled: boolean;
  source: 'official' | 'community' | 'local';
  config: Record<string, string>;
  configSchema?: PluginConfigField[];
}

export interface PluginConfigFieldSource {
  server: string;
  tool: string;
  args?: Record<string, string>;
  labelField: string;
  valueField: string;
}

export interface PluginConfigField {
  key: string;
  label: string;
  type: 'text' | 'select' | 'boolean';
  required?: boolean;
  default?: string;
  options?: { label: string; value: string }[];
  source?: PluginConfigFieldSource;
  description?: string;
  secret?: boolean;
}

export interface CatalogPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  capabilities: string[];
  level: 1 | 2;
  source: 'official' | 'community';
  icon?: string;
  tags?: string[];
  category?: string;
  downloadUrl: string;
  homepage?: string;
  license?: string;
  updatedAt?: string;
  downloads?: number;
  configSchema?: PluginConfigField[];
  sha256?: string;
}

// ── PM Work Items (from plugin MCP) ──

export interface PmWorkItem {
  id: string;
  title: string;
  status?: string;
  project?: string;
}

// ── Plugin Task Fields (injected into TaskForm) ──

export interface PluginTaskFieldSource {
  operation: string;
}

export interface PluginTaskFieldOnSelect {
  fetch?: {
    operation: string;
    args: Record<string, string>;
  };
  fill: Record<string, string>;
}

export interface PluginTaskField {
  key: string;
  label: string;
  type: 'text' | 'select';
  position: string;
  placeholder?: string;
  source?: PluginTaskFieldSource;
  onSelect?: PluginTaskFieldOnSelect;
  pluginId: string;  // added by the backend so the frontend knows which plugin owns this field
}

// DB row types (snake_case from SQLite)
export interface ProjectRow {
  id: string;
  name: string;
  path: string;
  repo: string | null;
  description: string;
  optional_skills: string;
  test_command: string;
  code_hosting: string | null;
  plugin_pm: string | null;
  plugin_pm_config: string;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  project_id: string;
  project_name: string;
  project_path: string;
  title: string;
  description: string;
  acceptance_criteria: string;
  images: string;
  model: string;
  status: string;
  pr_number: number | null;
  review_cycle: number;
  spec_suggestions: string;
  plan_summary: string | null;
  branch_name: string | null;
  criteria_status: string;
  pm_work_item_id: string | null;
  pm_work_item_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface LogRow {
  id: number;
  task_id: string | null;
  project_name: string | null;
  message: string;
  kind: string;
  created_at: string;
}

export interface KnowledgeRow {
  id: string;
  project_id: string | null;
  category: string;
  severity: string;
  title: string;
  description: string;
  source_task: string | null;
  source_pr: number | null;
  code_example: string | null;
  anti_pattern: string | null;
  tags: string;
  times_applied: number;
  created_at: string;
}

// Electron API type for window.electronAPI
export interface ElectronAPI {
  getProjects: () => Promise<Project[]>;
  createProject: (project: Omit<Project, 'createdAt' | 'updatedAt'>) => Promise<Project>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;

  getTasks: (projectId?: string) => Promise<Task[]>;
  getTask: (id: string) => Promise<Task>;
  createTask: (task: Partial<Task>) => Promise<Task>;
  updateTask: (id: string, updates: Partial<Task>) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;

  runAgent: (taskId: string, phase?: string) => Promise<void>;
  stopAgent: (taskId: string) => Promise<void>;
  healthCheck: () => Promise<HealthStatus>;

  onAgentLog: (callback: (log: AgentLogMessage) => void) => () => void;
  onAgentPhaseUpdate: (callback: (update: AgentPhaseUpdate) => void) => () => void;
  continueSpec: (taskId: string, action: 'accept' | 'edit', editedSpec?: string) => Promise<void>;
  continuePlan: (taskId: string, action: 'approve' | 'replan') => Promise<void>;
  continuePush: (taskId: string, action: 'approve' | 'reject' | 'revise', prompt?: string) => Promise<void>;
  fixTests: (taskId: string) => Promise<void>;
  analyzeRepo: (projectId: string) => Promise<string>;
  refineWithAI: (context: {
    field: 'description' | 'acceptanceCriteria';
    title: string;
    description: string;
    acceptanceCriteria: string;
    projectId: string;
  }) => Promise<string>;

  fetchPRComments: (projectPath: string, prNumber: number) => Promise<unknown>;

  readGlobalSkills: () => Promise<string[]>;
  writeGlobalSkills: (skills: string[]) => Promise<void>;
  readProjectSkills: (projectPath: string) => Promise<string[]>;
  writeProjectSkills: (projectPath: string, skills: string[]) => Promise<void>;

  getKnowledgeEntries: (projectId?: string) => Promise<KnowledgeEntry[]>;
  createKnowledgeEntry: (entry: Partial<KnowledgeEntry>) => Promise<KnowledgeEntry>;
  updateKnowledgeEntry: (id: string, updates: Partial<KnowledgeEntry>) => Promise<void>;
  deleteKnowledgeEntry: (id: string) => Promise<void>;

  getSettings: () => Promise<Settings>;
  updateSetting: (key: string, value: string) => Promise<void>;

  getLogs: (limit?: number, projectName?: string) => Promise<Log[]>;
  createLog: (log: Partial<Log>) => Promise<void>;
  clearLogs: () => Promise<void>;

  // Plugins
  getPlugins: () => Promise<Plugin[]>;
  getPlugin: (id: string) => Promise<Plugin>;
  installPlugin: (id: string, config: Record<string, string>) => Promise<void>;
  uninstallPlugin: (id: string) => Promise<void>;
  updatePluginConfig: (id: string, config: Record<string, string>) => Promise<void>;
  getProjectPlugins: (projectId: string) => Promise<Plugin[]>;
  activatePluginForProject: (projectId: string, pluginId: string, capability: string) => Promise<void>;
  deactivatePluginForProject: (projectId: string, capability: string) => Promise<void>;
  checkPluginConflicts: (projectId: string, pluginId: string) => Promise<string[]>;
  executePluginAction: (pluginId: string, actionId: string, context: Record<string, string>) => Promise<unknown>;
  getPluginCatalog: (forceRefresh?: boolean) => Promise<CatalogPlugin[]>;
  installCatalogPlugin: (pluginId: string, config: Record<string, string>) => Promise<void>;
  previewLocalPlugin: (folderPath: string) => Promise<{ id: string; name: string; version: string; description: string; author?: string; capabilities: string[]; level: 1 | 2; configSchema?: PluginConfigField[] }>;
  installPluginFromDisk: (folderPath: string, config: Record<string, string>) => Promise<void>;

  // License
  activateLicense: (key: string) => Promise<{ plan: string; limits: LicenseLimits }>;
  validateLicense: () => Promise<{ plan: string; limits: LicenseLimits }>;
  deactivateLicense: () => Promise<void>;
  getLicenseLimits: () => Promise<LicenseLimits>;

  // Updates
  checkForUpdate: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  skipUpdate: (version: string) => Promise<void>;
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void;
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => () => void;
  onUpdateError: (callback: (error: string) => void) => () => void;

  // Plugin compatibility
  fetchPluginConfigOptions: (
    server: string,
    tool: string,
    labelField: string,
    valueField: string,
    args?: Record<string, string>
  ) => Promise<{ label: string; value: string }[]>;
  listPmWorkItems: (pluginId: string) => Promise<PmWorkItem[]>;

  checkPluginCompatibility: () => Promise<PluginCompatResult[]>;
  onPluginCompatWarning: (callback: (results: PluginCompatResult[]) => void) => () => void;

  // Plugin task fields
  getTaskFieldsForProject: (projectId: string) => Promise<PluginTaskField[]>;
  executePluginOperation: (pluginId: string, operationId: string, args?: Record<string, string>) => Promise<unknown>;

  selectFolder: () => Promise<string | null>;
  selectImages: () => Promise<string[]>;
  getGitRemote: (folderPath: string) => Promise<string | null>;

  onMenuNavigate: (callback: (route: string) => void) => () => void;
  onShowAbout: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
