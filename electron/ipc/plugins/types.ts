// ── Plugin System Types ─────────────────────────────────────────────────────────

/** plugin.json — identity, capabilities, config schema */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  capabilities: string[];           // e.g. ["ship", "pr_feedback"] or ["pm", "enrichment"]
  level: 1 | 2;                     // 1 = declarative (JSON+MCP), 2 = adapter (TS module)
  requirements?: PluginRequirement[];
  requires?: { agentHub?: string };  // semver range for app compatibility
  configSchema?: ConfigField[];     // generates UI form automatically
  taskFields?: TaskField[];         // fields injected into TaskForm when plugin is active
}

/** Declarative field injected into TaskForm by a plugin */
export interface TaskField {
  key: string;                      // stored in task (e.g. "pmWorkItemId")
  label: string;
  type: 'text' | 'select';
  position: string;                 // "before:title", "after:model", "form.start", "form.end"
  placeholder?: string;
  source?: {                        // loads options from MCP (for select type)
    operation: string;              // reference to manifest.json operations key
  };
  onSelect?: {                      // triggered when user selects an item
    fetch?: {                       // fetch full detail of selected item
      operation: string;            // reference to manifest.json operations key
      args: Record<string, string>; // e.g. { "id": "$.id" } — $.field from selected item
    };
    fill: Record<string, string>;   // map result fields to task form fields
                                    // e.g. { "title": "$.title", "description": "$.overview" }
  };
}

export interface PluginRequirement {
  type: 'cli' | 'mcp';
  name: string;                     // e.g. "gh", "glab"
  description: string;
  checkCommand?: string;            // e.g. "gh --version"
}

export interface ConfigFieldSource {
  server: string;                   // MCP server name from ~/.claude.json
  tool: string;                     // MCP tool name to call
  args?: Record<string, string>;    // optional static args for the tool
  labelField: string;               // property name for the label in each result item
  valueField: string;               // property name for the value in each result item
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'select' | 'boolean';
  required?: boolean;
  default?: string;
  options?: { label: string; value: string }[];
  source?: ConfigFieldSource;       // dynamic options from MCP server (for select fields)
  description?: string;
  secret?: boolean;                 // encrypted in SQLite
}

/** manifest.json — workflow hooks, operations, phases, actions, enrichment */
export interface PluginWorkflow {
  hooks?: PluginHook[];
  phases?: PluginPhase[];
  operations?: Record<string, PluginOperation>;
  actions?: PluginAction[];
  enrichment?: PluginEnrichment[];
  fieldMappings?: Record<string, string>;
  statusMappings?: Record<string, string>;
}

export interface PluginHook {
  event: string;                    // e.g. "on:quality_pass", "on:pr_created"
  operation: string;                // reference to operations key
  priority?: number;                // lower = runs first (default 100)
  blocking?: boolean;               // wait for completion (default false)
  condition?: string;               // optional condition expression
  // Inline operation fields (PM plugin style: tool/server/args on hook itself)
  tool?: string;
  server?: string;
  args?: Record<string, string>;
  // Special fields
  action?: string;                  // e.g. "update_status"
  statusMap?: string;               // e.g. "in_review", "done" — resolved via plugin statusMap
  iterate?: string;                 // e.g. "subtasks", "criteria" — execute once per item
}

export interface PluginPhase {
  id: string;
  label: string;
  after: string;                    // "core_complete" or another phase id
  capability: string;               // e.g. "ship", "pr_feedback"
  icon?: string;
  promptTemplate?: string;          // prompt template for this phase
}

export interface PluginOperation {
  tool: string;                     // MCP tool name
  server: string;                   // MCP server name
  args: Record<string, string>;     // args with {variable} placeholders
  fieldMap?: Record<string, string>; // JSONPath-like field extraction from result
  description?: string;
}

export interface PluginAction {
  id: string;
  label: string;
  icon?: string;
  operation: string;                // reference to operations key
  context: 'task' | 'project';     // where the button appears
}

export interface PluginEnrichment {
  event: string;                    // e.g. "on:before_spec"
  operation: string;                // reference to operations key
  target: string;                   // where data goes: "prompt_section", "task_field", etc.
  template?: string;                // template to format the enrichment data
}

/** setup.json — installation steps */
export interface PluginSetup {
  steps: SetupStep[];
}

export interface SetupStep {
  type: 'mcp_add' | 'cli_check' | 'config_write';
  description: string;
  command?: string;                 // for mcp_add: "claude mcp add ..."
  args?: Record<string, string>;    // for mcp_add
}

/** Registry entry — installed plugin state */
export interface InstalledPlugin {
  id: string;
  version: string;
  enabled: boolean;
  config: Record<string, string>;
  installedAt: string;
  pluginDir: string;                // filesystem path to plugin files
  source: 'official' | 'community' | 'local'; // who published it
  manifest?: PluginManifest;        // loaded at runtime
  workflow?: PluginWorkflow;        // loaded at runtime
}

/** Catalog entry — remote registry plugin */
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
  configSchema?: ConfigField[];
  sha256?: string;
}

/** Context passed to hook execution */
export interface HookContext {
  taskId?: string;
  projectId?: string;
  projectPath?: string;
  taskTitle?: string;
  taskDescription?: string;
  branchName?: string;
  prNumber?: number;
  phase?: number;
  phaseLabel?: string;
  reviewLoop?: number;
  error?: string;              // for workflow_failed, ship_failed
  specSuggestions?: string[];  // for spec_needs_input
  planSummary?: string;        // for plan_ready
  commentCount?: number;       // for pr_changes_requested
  pmWorkItemId?: string;       // PM work item ID (for PM plugin hooks)
  pluginConfig?: Record<string, string>;
  extra?: Record<string, unknown>;
}

/** Resolved workflow phase (core + plugin) */
export interface ResolvedPhase {
  id: string;
  label: string;
  phase: number;
  source: 'core' | string;         // 'core' or plugin id
  icon?: string;
  capability?: string;
}
