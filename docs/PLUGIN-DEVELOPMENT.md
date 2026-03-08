# Plugin Development Guide — Agent Hub

This document describes everything needed to create a plugin for Agent Hub. Plugins extend the SDD workflow without modifying Agent Hub's core code.

---

## Table of Contents

1. [Overview](#overview)
2. [Plugin Architecture](#plugin-architecture)
3. [Plugin Package Structure](#plugin-package-structure)
4. [plugin.json — Identity & Configuration](#pluginjson--identity--configuration)
   - [Config Schema & Dynamic Options](#config-field-types)
   - [Task Fields — Dynamic Form Injection](#task-fields--dynamic-form-injection)
5. [manifest.json — Workflow Integration](#manifestjson--workflow-integration)
6. [setup.json — Installation Steps](#setupjson--installation-steps)
7. [Workflow Hooks Reference](#workflow-hooks-reference)
8. [Field Mapping with JSONPath](#field-mapping-with-jsonpath)
9. [Plugin Capabilities & Conflict Resolution](#plugin-capabilities--conflict-resolution)
10. [Level 2 Plugins — TypeScript Adapters](#level-2-plugins--typescript-adapters)
11. [Distribution & Installation](#distribution--installation)
12. [Complete Examples](#complete-examples)
13. [Testing Your Plugin](#testing-your-plugin)

---

## Overview

Agent Hub plugins are **declarative packages** that tell Agent Hub:

1. **What they need** — configuration fields (tokens, URLs, etc.)
2. **How to set up** — MCP server configuration, CLI checks
3. **What they do** — which workflow events they react to and how

Plugins do NOT contain application code that runs inside Agent Hub (except Level 2 adapters for Code Hosting). They work by:

- Declaring **hooks** that subscribe to workflow events
- Declaring **operations** that map to MCP tool calls
- Declaring **phases** that extend the workflow (optional)
- Declaring **actions** that add manual buttons to the UI
- Declaring **task fields** that inject dynamic fields into the task creation/edit form

The MCP (Model Context Protocol) is the universal transport layer. If a service has an MCP server, it can be integrated as a plugin.

---

## Plugin Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     AGENT HUB CORE                           │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  SDD Workflow Engine (orchestrator.ts)                  │  │
│  │                                                        │  │
│  │  Phase 0: Spec Review  ──→ fires: on:before_spec,      │  │
│  │                              on:spec_complete           │  │
│  │  Phase 1: Plan         ──→ fires: on:plan_approved      │  │
│  │  Phase 2: Implement    ──→ fires: on:implement_complete │  │
│  │  Phase 3: Quality Gate ──→ fires: on:quality_pass,      │  │
│  │                              on:quality_fail            │  │
│  │           ↓                  on:core_complete           │  │
│  │  (end of core)                                         │  │
│  └──────────────┬─────────────────────────────────────────┘  │
│                 │                                             │
│  ┌──────────────▼─────────────────────────────────────────┐  │
│  │  Plugin Engine (plugin-engine.ts)                       │  │
│  │                                                        │  │
│  │  1. Loads installed plugins from ~/.config/agent-hub/   │  │
│  │  2. Reads manifest.json for each active plugin          │  │
│  │  3. Registers hooks, phases, enrichments, actions       │  │
│  │  4. On event → executes matching hooks via MCP          │  │
│  │  5. If plugin provides phases → appends to workflow     │  │
│  └────────────────────────────────────────────────────────┘  │
│                 │                                             │
│  ┌──────────────▼─────────────────────────────────────────┐  │
│  │  MCP Layer (Claude Code CLI)                            │  │
│  │                                                        │  │
│  │  Claude CLI loads MCPs from ~/.claude.json              │  │
│  │  Plugin operations are executed as MCP tool calls       │  │
│  │  within Claude CLI prompts                              │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Two Levels of Plugins

| Level | Mechanism | Use case | Examples |
|-------|-----------|----------|----------|
| **Level 1** | JSON manifests + MCP | Any integration with normalizable APIs | PM tools, Notifications, CI/CD, Docs, Monitoring |
| **Level 2** | TypeScript adapter module | Integrations with complex, platform-specific logic | Code Hosting (GitHub, GitLab, Bitbucket) |

Most plugins are Level 1. Level 2 is reserved for Code Hosting because review thread handling, PR creation, and comment cleanup logic varies dramatically between platforms and cannot be expressed declaratively.

---

## Plugin Package Structure

Every plugin is a directory with the following files:

```
agent-hub-plugin-{name}/
├── plugin.json              # REQUIRED — Identity, requirements, config schema
├── manifest.json            # REQUIRED — Workflow integration (hooks, operations, phases)
├── setup.json               # REQUIRED — Installation/uninstallation steps
├── icon.svg                 # OPTIONAL — Plugin icon (48x48 recommended)
├── README.md                # OPTIONAL — Documentation for the user
└── adapter/                 # ONLY FOR LEVEL 2 — TypeScript adapter code
    ├── index.ts             # Implements CodeHostingPlugin interface
    └── tsconfig.json        # Compile configuration
```

### File Purposes

| File | Purpose | When read |
|------|---------|-----------|
| `plugin.json` | Displayed in the plugin store, generates the config form | Plugin listing, installation |
| `manifest.json` | Loaded when building a project's workflow | Every task execution |
| `setup.json` | Executed during install/uninstall | Install and uninstall only |
| `icon.svg` | Shown in the plugins UI | Plugin listing |
| `README.md` | Shown when user clicks "More info" | On demand |

---

## plugin.json — Identity & Configuration

This file defines who the plugin is and what it needs from the user.

### Full Schema

```json
{
  "id": "string — unique identifier, lowercase, hyphens only (e.g., 'pm-tool', 'jira', 'slack')",
  "name": "string — human-readable display name",
  "version": "string — semver (e.g., '1.0.0')",
  "icon": "string — path to icon file relative to plugin dir (e.g., 'icon.svg')",
  "author": "string — author or organization name",
  "description": "string — one-line description shown in plugin store",
  "homepage": "string — URL to plugin documentation or project page",
  "license": "string — SPDX license identifier (e.g., 'MIT')",

  "requires": {
    "agentHub": "string — semver range for Agent Hub compatibility (e.g., '>=1.0.0')",
    "mcp": "string | null — MCP server name required in Claude Code config (e.g., 'pm-tool')",
    "cli": "string | null — CLI command required on system PATH (e.g., 'gh', 'glab')"
  },

  "configSchema": {
    "<fieldName>": {
      "label": "string — field label shown in the UI",
      "type": "string — field type (see table below)",
      "required": "boolean — whether the field must be filled",
      "default": "any — default value (optional)",
      "placeholder": "string — placeholder text (optional)",
      "helpUrl": "string — link to docs for getting this value (optional)",
      "helpText": "string — inline help text below the field (optional)",
      "options": "string[] — choices for 'select' and 'multiselect' types",
      "validation": "string — regex pattern for validation (optional)",
      "source": {
        "server": "string — MCP server name from ~/.claude.json",
        "tool": "string — MCP tool name to call for dynamic options",
        "labelField": "string — property name for option label in results",
        "valueField": "string — property name for option value in results",
        "args": "object — optional static args for the MCP tool call"
      }
    }
  },

  "taskFields": [
    {
      "key": "string — field key stored in the task (e.g., 'pmWorkItemId')",
      "label": "string — field label shown in the TaskForm UI",
      "type": "string — 'text' or 'select'",
      "position": "string — where to inject the field in the form (see positions below)",
      "placeholder": "string — placeholder text (optional)",
      "source": {
        "operation": "string — reference to a manifest.json operation that returns a list"
      },
      "onSelect": {
        "fetch": {
          "operation": "string — manifest.json operation to call for full item detail",
          "args": { "key": "string — $.field maps to selected item property" }
        },
        "fill": {
          "<formField>": "string — $.field from fetched result to auto-fill into the task form"
        }
      }
    }
  ]
}
```

### Config Field Types

| Type | UI rendered | Storage | Notes |
|------|-------------|---------|-------|
| `text` | Text input | Plain text | General purpose |
| `url` | URL input with validation | Plain text | Must be valid URL |
| `email` | Email input with validation | Plain text | Must be valid email |
| `secret` | Password input with show/hide toggle | **Encrypted** in SQLite | For API tokens, passwords |
| `select` | Dropdown | Plain text | Requires `options` array |
| `multiselect` | Checkbox group | JSON array | Requires `options` array |
| `number` | Numeric input | Number | Optional min/max via validation |
| `boolean` | Toggle switch | Boolean | true/false |

### Dynamic Config Options via MCP

Config fields of type `select` can declare a `source` property to load options dynamically from an MCP server at runtime, instead of using a static `options` array. This is useful when the available choices depend on the user's account data (e.g., project list, status list, workspace list).

```json
{
  "key": "statusInProgress",
  "label": "Status: In Progress",
  "type": "select",
  "required": true,
  "source": {
    "server": "pm-tool",
    "tool": "list_requirement_statuses",
    "labelField": "name",
    "valueField": "id"
  }
}
```

When the plugin config form renders, Agent Hub calls the specified MCP `tool` on `server` and populates the dropdown with results, using `labelField` for display and `valueField` for the stored value. If the MCP call fails, the field degrades to a manual text input.

### Task Fields — Dynamic Form Injection

Plugins can declare `taskFields` to inject dynamic fields into the TaskForm when the plugin is active for a project. This is how PM tools add a requirement selector, and any plugin type can add fields relevant to task creation.

**How it works:**

1. User selects a project in TaskForm
2. Agent Hub calls `plugins:getTaskFields` for that project
3. Fields declared by active plugins are rendered at their declared positions
4. When user interacts with a field (e.g., selects an item), the plugin's `onSelect` triggers:
   - `fetch`: calls an MCP operation to get full item details
   - `fill`: auto-completes task form fields from the fetched data

**Position values:**

| Position | Where it renders |
|----------|-----------------|
| `form.start` | Top of the form (before all fields) |
| `before:project` | Before the project selector |
| `after:project` | After the project selector |
| `before:title` | Before the title field |
| `after:title` | After the title field |
| `before:description` | Before the spec/description field |
| `after:description` | After the spec/description field |
| `before:criteria` | Before the acceptance criteria field |
| `after:criteria` | After the acceptance criteria field |
| `before:images` | Before the images section |
| `after:images` | After the images section |
| `before:model` | Before the model selector |
| `after:model` | After the model selector |
| `form.end` | Bottom of the form (after all fields) |

**`onSelect.fill` target fields:**

The `fill` mapping keys correspond to TaskForm fields:

| Fill key | Task form field |
|----------|----------------|
| `title` | Task title |
| `description` | Spec / description textarea |
| `acceptanceCriteria` | Acceptance criteria (array joins with newlines) |
| `pmWorkItemId` | PM work item ID |
| `pmWorkItemUrl` | PM work item URL |

**`onSelect.fetch.args` syntax:**

Args use `$.field` to reference properties from the selected list item. For example, `{ "pmWorkItemId": "$.id" }` passes the selected item's `id` as the `pmWorkItemId` argument to the operation.

**Fallback behavior:**

If the MCP call to load options fails, the field degrades gracefully to a manual text input so the user can still enter the value by hand.

### Example — Task Fields (PM Requirement Selector)

```json
{
  "id": "pm-example",
  "name": "Example PM",
  "version": "1.0.0",
  "capabilities": ["pm"],
  "level": 1,

  "taskFields": [
    {
      "key": "pmWorkItemId",
      "label": "Requirement",
      "type": "select",
      "position": "before:title",
      "placeholder": "Search requirements...",
      "source": {
        "operation": "listMyWork"
      },
      "onSelect": {
        "fetch": {
          "operation": "fetch",
          "args": { "pmWorkItemId": "$.id" }
        },
        "fill": {
          "title": "$.title",
          "description": "$.description",
          "acceptanceCriteria": "$.criteria",
          "pmWorkItemUrl": "$.figmaLink"
        }
      }
    }
  ]
}
```

When a user selects "My Requirement" from the dropdown:
1. `listMyWork` operation is called → populates the searchable dropdown
2. User picks an item → `fetch` operation is called with the item's ID
3. The fetched requirement's title, description, and criteria are auto-filled into the task form
4. User can review and edit before saving

This pattern works identically for Jira, Linear, Azure DevOps, or any PM tool — only the `operations` in `manifest.json` and the `fill` field paths change.

### Example — PM Tool (Config Schema)

```json
{
  "id": "pm-tool",
  "name": "Example PM Tool",
  "version": "1.0.0",
  "icon": "icon.svg",
  "author": "Example Corp",
  "description": "Sync tasks bidirectionally with Example PM Tool",
  "homepage": "https://pm.example.com",
  "license": "MIT",

  "requires": {
    "agentHub": ">=1.0.0",
    "mcp": "pm-tool"
  },

  "configSchema": {
    "mcpUrl": {
      "label": "MCP Server URL",
      "type": "url",
      "default": "https://pm-mcp.example.com/api/v1/mcp/",
      "required": true,
      "helpText": "The MCP endpoint URL for your PM Tool instance"
    },
    "token": {
      "label": "API Token",
      "type": "secret",
      "placeholder": "mcp_xxxx...",
      "required": true,
      "helpUrl": "https://pm.example.com/settings/api-tokens",
      "helpText": "Generate a token in PM Tool → Settings → API Tokens"
    },
    "scope": {
      "label": "Scope",
      "type": "select",
      "options": ["global", "project"],
      "default": "global",
      "required": true,
      "helpText": "Global: available to all projects. Project: only for selected projects."
    }
  }
}
```

---

## manifest.json — Workflow Integration

This is the core of the plugin. It defines HOW the plugin interacts with Agent Hub's workflow.

### Full Schema

```json
{
  "provides": ["string — capability IDs this plugin provides (optional)"],

  "operations": {
    "<operationName>": {
      "tool": "string — MCP tool name to call",
      "args": { "key": "value — arguments, supports {variable} templates" },
      "fieldMap": {
        "<normalizedField>": "string — JSONPath to extract from MCP response"
      }
    }
  },

  "statusMap": {
    "<externalStatusName>": "string — normalized status (backlog|todo|in_progress|in_review|done|cancelled)"
  },

  "urlPattern": "string — regex with named group <workItemId> to parse URLs",

  "workflow": {
    "phases": [
      {
        "id": "string — unique phase ID",
        "capability": "string — capability this phase provides",
        "label": "string — display label",
        "after": "string — phase ID or 'core_complete' to position this phase",
        "icon": "string — icon name",
        "manual": "boolean — whether this phase requires manual user action (default: false)"
      }
    ],

    "hooks": {
      "<eventName>": {
        "tool": "string — MCP tool to call (optional, for MCP-based hooks)",
        "args": { "key": "value — arguments with {variable} templates" },
        "action": "string — built-in action type (optional, alternative to tool)",
        "template": "string — message template for notification actions",
        "iterate": "string — context array to iterate over (e.g., 'subtasks', 'criteria')",
        "priority": "number — execution order, lower = first (default: 50)",
        "blocking": "boolean — if true, hook failure stops the workflow (default: false)",
        "description": "string — human-readable description of what this hook does"
      }
    },

    "enrichment": {
      "<eventName>": {
        "tool": "string — MCP tool to call",
        "args": { "key": "value" },
        "inject": {
          "<targetField>": "string — JSONPath to extract from MCP response"
        },
        "description": "string — what data this enrichment provides"
      }
    },

    "actions": {
      "<actionId>": {
        "label": "string — button label in UI",
        "icon": "string — icon name",
        "tool": "string — MCP tool to call",
        "args": { "key": "value" },
        "description": "string — tooltip text"
      }
    }
  }
}
```

### Template Variables

Variables available in `args` templates, resolved at runtime:

| Variable | Description | Available in |
|----------|-------------|-------------|
| `{taskId}` | Agent Hub task ID | All hooks |
| `{taskTitle}` | Task title | All hooks |
| `{taskDescription}` | Task description | All hooks |
| `{projectId}` | Agent Hub project ID | All hooks |
| `{projectName}` | Project name | All hooks |
| `{projectPath}` | Local project path | All hooks |
| `{pmWorkItemId}` | PM tool work item ID (from `tasks.pm_work_item_id`) | All hooks (if PM linked) |
| `{pmWorkItemUrl}` | PM tool work item URL | All hooks (if PM linked) |
| `{branchName}` | Git branch name | After git prep |
| `{prNumber}` | PR number | After ship phase |
| `{model}` | AI model (sonnet/opus) | All hooks |
| `{reviewLoop}` | Current review loop number | Quality gate hooks |
| `{subtask}` | Current subtask text (when iterating) | With `iterate: "subtasks"` |
| `{subtaskId}` | Current subtask ID (when iterating) | With `iterate: "subtasks"` |
| `{criterionId}` | Current criterion ID (when iterating) | With `iterate: "criteria"` |
| `{issueTitle}` | QA issue title | `on:quality_fail` |
| `{issueDetail}` | QA issue detail | `on:quality_fail` |
| `{error}` | Error message | `on:workflow_failed` |
| `{statusId}` | Resolved status ID from `statusMap` | `action: "update_status"` |
| `{config.*}` | Plugin config values (e.g., `{config.mcpUrl}`) | All |

### Example — PM Tool manifest.json

```json
{
  "provides": ["pm_sync"],

  "operations": {
    "fetch": {
      "tool": "get_requirement",
      "args": { "requirement_id": "{pmWorkItemId}" },
      "fieldMap": {
        "id": "$.id",
        "title": "$.title",
        "description": "$.overview",
        "criteria": "$.acceptance_criteria[*].description",
        "criteriaIds": "$.acceptance_criteria[*].id",
        "subtasks": "$.dev_tasks[*].description",
        "subtaskIds": "$.dev_tasks[*].id",
        "status": "$.status.name",
        "figmaLink": "$.figma_link"
      }
    },
    "listMyWork": {
      "tool": "get_my_work",
      "args": {},
      "fieldMap": {
        "id": "$.id",
        "title": "$.title",
        "description": "$.overview",
        "status": "$.status.name",
        "project": "$.project_name"
      }
    },
    "createSubtask": {
      "tool": "add_dev_task",
      "args": { "requirement_id": "{pmWorkItemId}", "description": "{subtask}" }
    },
    "completeSubtask": {
      "tool": "complete_dev_task",
      "args": { "task_id": "{subtaskId}" }
    },
    "completeCriterion": {
      "tool": "complete_acceptance_criterion",
      "args": { "criterion_id": "{criterionId}" }
    },
    "updateStatus": {
      "tool": "update_requirement_status",
      "args": { "requirement_id": "{pmWorkItemId}", "status_id": "{statusId}" }
    },
    "createQAIssue": {
      "tool": "create_qa_issue",
      "args": { "requirement_id": "{pmWorkItemId}", "title": "{issueTitle}", "description": "{issueDetail}" }
    },
    "addComment": {
      "tool": "add_comment",
      "args": { "requirement_id": "{pmWorkItemId}", "content": "{text}" }
    },
    "tagAgent": {
      "tool": "tag_requirement_agent",
      "args": { "requirement_id": "{pmWorkItemId}" }
    }
  },

  "statusMap": {
    "Backlog": "backlog",
    "To Do": "todo",
    "In Progress": "in_progress",
    "In Review": "in_review",
    "Done": "done"
  },

  "urlPattern": "https://pm\\.example\\.com/.*/requirement/(?<workItemId>[a-f0-9-]+)",

  "workflow": {
    "hooks": {
      "on:workflow_started": {
        "tool": "tag_requirement_agent",
        "args": { "requirement_id": "{pmWorkItemId}" },
        "priority": 10,
        "blocking": false,
        "description": "Tag requirement as being worked by agent"
      },
      "on:plan_approved": {
        "tool": "add_dev_task",
        "args": { "requirement_id": "{pmWorkItemId}", "description": "{subtask}" },
        "iterate": "subtasks",
        "priority": 20,
        "blocking": false,
        "description": "Create dev tasks in PM from the approved plan"
      },
      "on:implement_complete": {
        "tool": "complete_dev_task",
        "args": { "task_id": "{subtaskId}" },
        "iterate": "subtasks",
        "priority": 20,
        "blocking": false,
        "description": "Mark dev tasks as complete in PM"
      },
      "on:quality_pass": {
        "tool": "complete_acceptance_criterion",
        "args": { "criterion_id": "{criterionId}" },
        "iterate": "criteria",
        "priority": 20,
        "blocking": false,
        "description": "Mark acceptance criteria as met in PM"
      },
      "on:quality_fail": {
        "tool": "create_qa_issue",
        "args": { "requirement_id": "{pmWorkItemId}", "title": "{issueTitle}", "description": "{issueDetail}" },
        "priority": 30,
        "blocking": false,
        "description": "Create QA issue in PM when quality gate fails"
      },
      "on:pr_created": {
        "action": "update_status",
        "statusMap": "in_review",
        "priority": 20,
        "blocking": false,
        "description": "Update PM status to In Review when PR is created"
      },
      "on:task_complete": {
        "action": "update_status",
        "statusMap": "done",
        "priority": 20,
        "blocking": false,
        "description": "Update PM status to Done when task is completed"
      },
      "on:workflow_failed": {
        "tool": "add_comment",
        "args": { "requirement_id": "{pmWorkItemId}", "content": "Agent Hub workflow failed: {error}" },
        "priority": 90,
        "blocking": false,
        "description": "Post failure comment to PM requirement"
      }
    },

    "enrichment": {
      "on:before_spec": {
        "tool": "get_requirement",
        "args": { "requirement_id": "{pmWorkItemId}" },
        "inject": {
          "title": "$.title",
          "description": "$.overview",
          "criteria": "$.acceptance_criteria[*].description",
          "figmaLink": "$.figma_link"
        },
        "description": "Fetch requirement details from PM to enrich the spec review"
      }
    },

    "actions": {
      "sync_pm": {
        "label": "Sync with PM",
        "icon": "refresh-cw",
        "tool": "get_requirement",
        "args": { "requirement_id": "{pmWorkItemId}" },
        "description": "Manually refresh requirement data from PM Tool"
      }
    }
  }
}
```

---

## setup.json — Installation Steps

Defines what happens when the user installs or uninstalls the plugin. Steps are executed sequentially by Agent Hub's plugin installer.

### Step Actions

| Action | What it does | Parameters |
|--------|-------------|------------|
| `mcp-add` | Runs `claude mcp add` to configure an MCP server | `name`, `transport`, `url`, `headers`, `scope` |
| `mcp-remove` | Runs `claude mcp remove` to remove an MCP server | `name`, `scope` |
| `mcp-test` | Verifies MCP connection by calling `tools/list` | `name`, `expectedTool` |
| `cli-check` | Checks if a CLI command is available on PATH | `command`, `installHint`, `installUrl` |
| `cli-exec` | Runs a CLI command and checks exit code | `command`, `args`, `expectSuccess`, `failMessage` |

### Parameter Templating

Setup step parameters can reference config values using `{config.fieldName}`:

```json
{
  "url": "{config.mcpUrl}",
  "headers": { "Authorization": "Bearer {config.token}" }
}
```

### Example — PM Tool setup.json

```json
{
  "steps": [
    {
      "id": "configure-mcp",
      "label": "Configuring MCP server...",
      "action": "mcp-add",
      "params": {
        "name": "pm-tool",
        "transport": "http",
        "url": "{config.mcpUrl}",
        "headers": {
          "Authorization": "Bearer {config.token}"
        },
        "scope": "{config.scope}"
      }
    },
    {
      "id": "verify-connection",
      "label": "Verifying connection...",
      "action": "mcp-test",
      "params": {
        "name": "pm-tool",
        "expectedTool": "get_my_work"
      }
    }
  ],

  "uninstall": [
    {
      "id": "remove-mcp",
      "label": "Removing MCP server...",
      "action": "mcp-remove",
      "params": {
        "name": "pm-tool",
        "scope": "{config.scope}"
      }
    }
  ]
}
```

### Example — GitLab setup.json (CLI-based)

```json
{
  "steps": [
    {
      "id": "check-cli",
      "label": "Checking glab CLI...",
      "action": "cli-check",
      "params": {
        "command": "glab",
        "installHint": "brew install glab",
        "installUrl": "https://gitlab.com/gitlab-org/cli/-/releases"
      }
    },
    {
      "id": "check-auth",
      "label": "Verifying authentication...",
      "action": "cli-exec",
      "params": {
        "command": "glab",
        "args": ["auth", "status"],
        "expectSuccess": true,
        "failMessage": "Not authenticated. Run 'glab auth login' first."
      }
    }
  ],

  "uninstall": []
}
```

---

## Workflow Hooks Reference

### Hook Execution Model

1. When the workflow engine fires an event, it collects all hooks registered for that event
2. Hooks are sorted by `priority` (ascending — lower number runs first)
3. Each hook is executed sequentially
4. If a hook has `blocking: true` and fails, the workflow pauses with an error
5. If a hook has `blocking: false` (default) and fails, the error is logged but the workflow continues
6. Hooks can be `tool`-based (call an MCP tool) or `action`-based (built-in behavior)

### Available Events

#### UI Events (fired in the renderer process)

| Event | When fired | Typical use |
|-------|-----------|-------------|
| `on:url_pasted` | User pastes a PM URL in the task form | Fetch work item, pre-fill form fields |

#### Lifecycle Events (fired in the main process)

| Event | When fired | Context available |
|-------|-----------|-------------------|
| `on:workflow_started` | Task execution begins | taskId, taskTitle, projectId, pmWorkItemId |
| `on:task_complete` | Entire workflow finishes successfully | taskId, taskTitle, prNumber, branchName |
| `on:workflow_failed` | Workflow encounters a fatal error | taskId, taskTitle, error |
| `on:workflow_aborted` | User manually stops the workflow | taskId |

#### Phase Transition Events

| Event | When fired | Context available |
|-------|-----------|-------------------|
| `on:before_spec` | Before Phase 0 starts (enrichment point) | taskId, pmWorkItemId |
| `on:spec_complete` | Spec review passes (user accepts) | taskId, taskTitle, description |
| `on:spec_needs_input` | Spec incomplete, waiting for user | taskId, specSuggestions |
| `on:plan_ready` | Plan generated, waiting for approval | taskId, planSummary |
| `on:plan_approved` | User approves the plan | taskId, subtasks[] |
| `on:implement_complete` | Phase 2 finishes | taskId, branchName |
| `on:review_started` | Quality gate loop begins | taskId, reviewLoop |
| `on:quality_pass` | Quality gate passes | taskId, criteria[] |
| `on:quality_fail` | Quality gate fails | taskId, issueTitle, issueDetail |
| `on:quality_max_loops` | Max review loops reached | taskId, reviewLoop |
| `on:core_complete` | All core phases done (Phase 0-3) | taskId, branchName |

#### Plugin-Emitted Events (fired by other plugins)

| Event | Emitted by | Context available |
|-------|-----------|-------------------|
| `on:ship_started` | Code Hosting plugin | taskId |
| `on:pr_created` | Code Hosting plugin | taskId, prNumber, branchName |
| `on:pr_approved` | Code Hosting plugin | taskId, prNumber |
| `on:pr_changes_requested` | Code Hosting plugin | taskId, prNumber, commentCount |
| `on:pr_fix_pushed` | Code Hosting plugin | taskId, prNumber |
| `on:ship_failed` | Code Hosting plugin | taskId, error |
| `on:deploy_started` | CI/CD plugin | taskId |
| `on:deploy_complete` | CI/CD plugin | taskId, deployUrl |
| `on:deploy_failed` | CI/CD plugin | taskId, error |

Plugins can emit custom events. Any other plugin can listen to them. The event name must be prefixed with the plugin ID to avoid collisions: `on:{pluginId}:{eventName}`.

---

## Field Mapping with JSONPath

The `fieldMap` in operations uses JSONPath expressions to extract data from MCP tool responses. This normalizes different data structures into a common format that Agent Hub understands.

### Supported JSONPath Syntax

| Expression | Meaning | Example |
|-----------|---------|---------|
| `$.field` | Direct field access | `$.title` → `"Fix bug"` |
| `$.nested.field` | Nested field access | `$.status.name` → `"In Progress"` |
| `$.array[*].field` | Extract field from all array items | `$.criteria[*].description` → `["criterion 1", "criterion 2"]` |
| `$.array[0].field` | Extract from specific array index | `$.criteria[0].id` → `"abc-123"` |

### How Field Mapping Works

1. MCP tool returns a JSON response
2. Agent Hub applies each JSONPath in `fieldMap` to the response
3. Results are normalized into Agent Hub's common `PMWorkItem` interface:

```typescript
interface PMWorkItem {
  id: string;           // Unique identifier in the PM tool
  title: string;        // Work item title
  description: string;  // Description/overview (may contain HTML)
  status: string;       // Status name (mapped via statusMap)
  project: string;      // Project name in the PM tool
  criteria: string[];   // Acceptance criteria texts
  criteriaIds: string[]; // Acceptance criteria IDs (for completion)
  subtasks: string[];   // Subtask/dev-task descriptions
  subtaskIds: string[]; // Subtask IDs (for completion)
  figmaLink?: string;   // Optional design link
}
```

### Example — Different PM Tools, Same Output

**PM Tool response:**
```json
{ "title": "Fix bug", "overview": "<p>Details...</p>", "acceptance_criteria": [{"id": "ac1", "description": "Validates input"}] }
```
**fieldMap:** `"title": "$.title"`, `"description": "$.overview"`, `"criteria": "$.acceptance_criteria[*].description"`

**Jira response:**
```json
{ "fields": { "summary": "Fix bug", "description": "Details...", "subtasks": [{"key": "PROJ-2", "fields": {"summary": "Subtask 1"}}] } }
```
**fieldMap:** `"title": "$.fields.summary"`, `"description": "$.fields.description"`, `"subtasks": "$.fields.subtasks[*].fields.summary"`

Both normalize to the same `PMWorkItem` structure. Agent Hub doesn't know the difference.

---

## Plugin Capabilities & Conflict Resolution

### What Are Capabilities?

A capability is a named function that only one plugin can provide per project. This prevents conflicts like having both GitHub and GitLab trying to create PRs for the same project.

```json
"provides": ["ship", "pr_feedback"]
```

### Conflict Rules

1. **Only one plugin per capability per project.** If GitHub provides `ship` and is active, GitLab cannot be activated on the same project.
2. **Hook-only plugins never conflict.** Plugins that don't declare `provides` can coexist freely.
3. **Conflicts are detected at activation time.** The UI prevents activating a conflicting plugin and shows which active plugin holds the capability.
4. **Different projects can use different plugins.** Project A can use GitHub, Project B can use GitLab.

### Common Capabilities

| Capability | Purpose | Typical providers |
|-----------|---------|-------------------|
| `ship` | Commit, push, create PR/MR | github, gitlab, bitbucket |
| `pr_feedback` | Fetch review comments, fix, re-push | github, gitlab, bitbucket |
| `pm_sync` | Bidirectional sync with PM tool | pm-tool, jira, linear, asana |
| `ci_cd` | Trigger and monitor pipelines | github-actions, gitlab-ci, jenkins |
| `notifications` | Send workflow notifications | slack, teams, discord |

Note: `notifications` is listed as a capability but you may want multiple notification channels. In that case, don't declare `provides` in notification plugins — just use hooks. The `provides` field is only necessary when having two providers active would cause conflicts.

---

## Level 2 Plugins — TypeScript Adapters

For Code Hosting plugins, the logic is too complex for declarative JSON (GraphQL queries, thread resolution, comment minimization, etc.). These plugins implement the `CodeHostingAdapter` interface.

### CodeHostingAdapter Interface

```typescript
// electron/ipc/agent/adapters/types.ts

interface CodeHostingCredentials {
  token?: string;          // API token (GH_TOKEN, GITLAB_TOKEN, etc.)
  authorName?: string;     // Git author name override
  authorEmail?: string;    // Git author email override
}

interface CodeHostingEnvVars {
  [key: string]: string | undefined;  // Env vars for subprocess injection
}

interface CreatePROptions {
  projectPath: string;
  branchName: string;
  baseBranch: string;
  title: string;
  body: string;
  taskId: string;
  projectName: string;
}

interface CreatePRResult {
  prNumber: number;
  prUrl: string;
  branchName: string;
}

interface CodeHostingAdapter {
  readonly id: string;     // 'github', 'gitlab', 'bitbucket'
  readonly name: string;   // Human-readable name
  readonly cli: string;    // CLI command required (e.g. 'gh', 'glab')

  // Build env vars from credentials for subprocess injection
  buildEnvVars(credentials: CodeHostingCredentials): CodeHostingEnvVars;

  // PR lifecycle
  createPR(options: CreatePROptions, env: CodeHostingEnvVars, q, getWindow): Promise<CreatePRResult>;
  fetchFeedback(options: FetchFeedbackOptions, env: CodeHostingEnvVars): Promise<FetchedPrFeedback>;
  postReplies(options: PostRepliesOptions, env: CodeHostingEnvVars): Promise<void>;
  resolveThreads(options: ResolveThreadsOptions, env: CodeHostingEnvVars): Promise<void>;
  minimizeOldComments(options: MinimizeOptions, env: CodeHostingEnvVars): Promise<void>;
  push(options: PushOptions, env: CodeHostingEnvVars, q, getWindow): Promise<void>;
}
```

### Per-Project Credential Resolution

Credentials are resolved by merging two layers:

1. **Global plugin config** — from `installed.json` (applies to all projects using this plugin)
2. **Per-project override** — from `projects.code_hosting_config` column (takes precedence)

```typescript
// electron/ipc/agent/adapters/registry.ts

function resolveCredentials(projectId, db): CodeHostingCredentials {
  // 1. Load global plugin config
  // 2. Apply per-project overrides (project wins)
  // 3. Return merged credentials
}

function resolveEnvVars(projectId, db): CodeHostingEnvVars | undefined {
  // 1. Get project's active code hosting plugin
  // 2. Get adapter for that plugin
  // 3. Resolve credentials
  // 4. adapter.buildEnvVars(credentials) → env vars
}
```

The orchestrator calls `resolveEnvVars()` at workflow start and passes the result to every subprocess call as `extraEnv`.

### Environment Variable Mapping

| Provider | Token var | Author vars |
|----------|-----------|-------------|
| GitHub | `GH_TOKEN` | `GIT_AUTHOR_NAME`, `GIT_COMMITTER_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_EMAIL` |
| GitLab | `GITLAB_TOKEN` | Same git vars |
| Bitbucket | `BITBUCKET_TOKEN` | Same git vars |

### Adding a New Provider

To add a new code hosting provider (e.g., GitLab):

1. Create `electron/ipc/agent/adapters/gitlab.ts` implementing `CodeHostingAdapter`
2. Register it in `registry.ts`: `adapters['gitlab'] = new GitLabAdapter()`
3. Create `plugin-registry/plugins/gitlab/plugin.json` with `configSchema`
4. The adapter's `buildEnvVars()` maps credentials to provider-specific env vars

### Per-Project Config in ProjectForm

When a code hosting plugin is active, the ProjectForm shows a "Project Credentials" section:

| Field | Purpose |
|-------|---------|
| Token | Override global API token for this project |
| Git Author Name | Override git commit author name |
| Git Author Email | Override git commit author email |

These are stored in `projects.code_hosting_config` as JSON. Empty fields fall back to global plugin config.

### Why Not Make Everything Level 2?

Level 1 (declarative) plugins are preferable because:
- **No code to maintain** — just JSON configuration
- **No compilation** — works immediately
- **No security risk** — JSON can't execute arbitrary code
- **Easier to create** — anyone can write JSON, not everyone writes TypeScript
- **MCP handles the complexity** — the MCP server is the adapter

Use Level 2 only when the integration requires complex orchestration logic that cannot be expressed as simple MCP tool calls (e.g., multi-step GraphQL mutations with conditional branching).

---

## Distribution & Installation

### Plugin Sources

| Source | How it works | Use case |
|--------|-------------|----------|
| **Built-in** | Bundled with Agent Hub in `plugins/registry/` | Official plugins (GitHub) |
| **Registry** | Listed in remote `registry.json`, downloaded on demand | Community plugins |
| **Custom URL** | User pastes a git repo URL or tarball URL | Private/internal plugins |

### Registry Format

```json
{
  "version": 1,
  "plugins": [
    {
      "id": "pm-tool",
      "name": "Example PM Tool",
      "version": "1.0.0",
      "source": "https://github.com/example/agent-hub-plugin-pm-tool",
      "type": "level1",
      "description": "Sync tasks with PM Tool"
    },
    {
      "id": "gitlab",
      "name": "GitLab",
      "version": "1.0.0",
      "source": "https://github.com/agent-hub/plugin-gitlab",
      "type": "level2",
      "description": "GitLab MR integration"
    }
  ]
}
```

### Installation Flow

1. User selects plugin from store or pastes URL
2. Agent Hub downloads plugin files to `~/.config/agent-hub/plugins/{id}/`
3. Validates `plugin.json` schema
4. Checks `requires` (Agent Hub version, MCP, CLI)
5. Renders config form from `configSchema`
6. User fills config and clicks "Install"
7. Executes `setup.json` steps sequentially
8. If Level 2: compiles TypeScript adapter
9. Registers in `~/.config/agent-hub/plugins/installed.json`
10. Plugin appears as "Installed" in UI

### Installed Plugins Storage

```
~/.config/agent-hub/
└── plugins/
    ├── installed.json          # Registry of installed plugins
    ├── pm-tool/                # Plugin files
    │   ├── plugin.json
    │   ├── manifest.json
    │   ├── setup.json
    │   └── icon.svg
    ├── github/
    │   ├── plugin.json
    │   ├── manifest.json
    │   ├── setup.json
    │   └── adapter/
    │       ├── index.ts
    │       └── dist/           # Compiled (Level 2 only)
    │           └── index.js
    └── slack/
        ├── plugin.json
        ├── manifest.json
        └── setup.json
```

### installed.json Format

```json
{
  "pm-tool": {
    "version": "1.0.0",
    "installedAt": "2026-03-07T12:00:00Z",
    "source": "https://github.com/example/agent-hub-plugin-pm-tool",
    "config": {
      "mcpUrl": "https://pm-mcp.example.com/api/v1/mcp/",
      "scope": "global"
    },
    "enabled": true
  }
}
```

Note: secrets (fields with `type: "secret"`) are NOT stored in `installed.json`. They are stored encrypted in Agent Hub's SQLite database.

### Uninstallation

1. User clicks "Uninstall"
2. Confirmation dialog: "This will remove {name} and its MCP configuration. Your task data will NOT be deleted."
3. Executes `setup.json.uninstall` steps
4. Removes plugin directory from `~/.config/agent-hub/plugins/{id}/`
5. Removes entry from `installed.json`
6. Tasks with `pm_work_item_id` retain their data but PM sync stops

---

## Complete Examples

### Minimal Plugin — Slack Notifications

```
agent-hub-plugin-slack/
├── plugin.json
├── manifest.json
├── setup.json
└── icon.svg
```

**plugin.json:**
```json
{
  "id": "slack",
  "name": "Slack Notifications",
  "version": "1.0.0",
  "author": "Agent Hub Community",
  "description": "Send workflow notifications to Slack channels",
  "homepage": "https://api.slack.com/messaging/webhooks",
  "license": "MIT",
  "requires": {
    "agentHub": ">=1.0.0"
  },
  "configSchema": {
    "webhookUrl": {
      "label": "Webhook URL",
      "type": "secret",
      "required": true,
      "helpUrl": "https://api.slack.com/messaging/webhooks",
      "helpText": "Create an Incoming Webhook in your Slack workspace"
    },
    "channel": {
      "label": "Default Channel",
      "type": "text",
      "placeholder": "#dev-updates",
      "required": false
    },
    "notifyOn": {
      "label": "Notify on events",
      "type": "multiselect",
      "options": ["task_started", "pr_created", "quality_pass", "task_complete", "task_failed"],
      "default": ["pr_created", "task_complete", "task_failed"],
      "required": true
    }
  }
}
```

**manifest.json:**
```json
{
  "workflow": {
    "hooks": {
      "on:workflow_started": {
        "action": "webhook",
        "template": "🚀 Task started: *{taskTitle}* ({projectName})",
        "priority": 90,
        "blocking": false,
        "condition": "config.notifyOn includes 'task_started'"
      },
      "on:pr_created": {
        "action": "webhook",
        "template": "📋 PR #{prNumber} created for *{taskTitle}*",
        "priority": 90,
        "blocking": false,
        "condition": "config.notifyOn includes 'pr_created'"
      },
      "on:quality_pass": {
        "action": "webhook",
        "template": "✅ Quality gate passed for *{taskTitle}*",
        "priority": 90,
        "blocking": false,
        "condition": "config.notifyOn includes 'quality_pass'"
      },
      "on:task_complete": {
        "action": "webhook",
        "template": "🎉 Task completed: *{taskTitle}* (PR #{prNumber})",
        "priority": 90,
        "blocking": false,
        "condition": "config.notifyOn includes 'task_complete'"
      },
      "on:workflow_failed": {
        "action": "webhook",
        "template": "❌ Task failed: *{taskTitle}* — {error}",
        "priority": 90,
        "blocking": false,
        "condition": "config.notifyOn includes 'task_failed'"
      }
    }
  }
}
```

**setup.json:**
```json
{
  "steps": [
    {
      "id": "test-webhook",
      "label": "Testing webhook connection...",
      "action": "webhook-test",
      "params": {
        "url": "{config.webhookUrl}",
        "message": "Agent Hub plugin installed successfully! 🎉"
      }
    }
  ],
  "uninstall": []
}
```

### Complete PM Plugin — Jira

**plugin.json:**
```json
{
  "id": "jira",
  "name": "Jira",
  "version": "1.0.0",
  "author": "Agent Hub Community",
  "description": "Sync tasks bidirectionally with Atlassian Jira",
  "homepage": "https://www.atlassian.com/software/jira",
  "license": "MIT",
  "requires": {
    "agentHub": ">=1.0.0",
    "mcp": "atlassian"
  },
  "configSchema": {
    "instanceUrl": {
      "label": "Jira Instance URL",
      "type": "url",
      "placeholder": "https://your-company.atlassian.net",
      "required": true
    },
    "email": {
      "label": "Email",
      "type": "email",
      "required": true,
      "helpText": "Your Atlassian account email"
    },
    "apiToken": {
      "label": "API Token",
      "type": "secret",
      "required": true,
      "helpUrl": "https://id.atlassian.com/manage-profile/security/api-tokens",
      "helpText": "Create an API token in your Atlassian account settings"
    },
    "defaultProject": {
      "label": "Default Project Key",
      "type": "text",
      "placeholder": "PROJ",
      "required": false,
      "helpText": "Used as default when listing issues"
    }
  }
}
```

**manifest.json:**
```json
{
  "provides": ["pm_sync"],

  "operations": {
    "fetch": {
      "tool": "get_issue",
      "args": { "issue_key": "{pmWorkItemId}" },
      "fieldMap": {
        "id": "$.key",
        "title": "$.fields.summary",
        "description": "$.fields.description",
        "status": "$.fields.status.name",
        "project": "$.fields.project.name",
        "criteria": "$.fields.customfield_10100[*].text",
        "subtasks": "$.fields.subtasks[*].fields.summary",
        "subtaskIds": "$.fields.subtasks[*].key"
      }
    },
    "listMyWork": {
      "tool": "search_issues",
      "args": { "jql": "assignee = currentUser() AND status != Done ORDER BY updated DESC" },
      "fieldMap": {
        "id": "$.key",
        "title": "$.fields.summary",
        "description": "$.fields.description",
        "status": "$.fields.status.name",
        "project": "$.fields.project.name"
      }
    },
    "updateStatus": {
      "tool": "transition_issue",
      "args": { "issue_key": "{pmWorkItemId}", "transition": "{status}" }
    },
    "addComment": {
      "tool": "add_comment",
      "args": { "issue_key": "{pmWorkItemId}", "body": "{text}" }
    },
    "completeSubtask": {
      "tool": "transition_issue",
      "args": { "issue_key": "{subtaskId}", "transition": "Done" }
    }
  },

  "statusMap": {
    "To Do": "todo",
    "In Progress": "in_progress",
    "In Review": "in_review",
    "Done": "done",
    "Backlog": "backlog"
  },

  "urlPattern": "https://[^/]+\\.atlassian\\.net/browse/(?<workItemId>[A-Z]+-\\d+)",

  "workflow": {
    "hooks": {
      "on:workflow_started": {
        "action": "update_status",
        "statusMap": "in_progress",
        "priority": 10,
        "blocking": false
      },
      "on:implement_complete": {
        "tool": "transition_issue",
        "args": { "issue_key": "{subtaskId}", "transition": "Done" },
        "iterate": "subtasks",
        "priority": 20,
        "blocking": false
      },
      "on:pr_created": {
        "action": "update_status",
        "statusMap": "in_review",
        "priority": 20,
        "blocking": false
      },
      "on:task_complete": {
        "action": "update_status",
        "statusMap": "done",
        "priority": 20,
        "blocking": false
      },
      "on:workflow_failed": {
        "tool": "add_comment",
        "args": { "issue_key": "{pmWorkItemId}", "body": "Agent Hub workflow failed: {error}" },
        "priority": 90,
        "blocking": false
      }
    },

    "enrichment": {
      "on:before_spec": {
        "tool": "get_issue",
        "args": { "issue_key": "{pmWorkItemId}" },
        "inject": {
          "title": "$.fields.summary",
          "description": "$.fields.description"
        }
      }
    },

    "actions": {
      "sync_jira": {
        "label": "Sync with Jira",
        "icon": "refresh-cw",
        "tool": "get_issue",
        "args": { "issue_key": "{pmWorkItemId}" }
      }
    }
  }
}
```

**setup.json:**
```json
{
  "steps": [
    {
      "id": "configure-mcp",
      "label": "Configuring Atlassian MCP server...",
      "action": "mcp-add",
      "params": {
        "name": "atlassian",
        "transport": "http",
        "url": "{config.instanceUrl}/mcp/",
        "headers": {
          "Authorization": "Basic {base64:{config.email}:{config.apiToken}}"
        },
        "scope": "global"
      }
    },
    {
      "id": "verify-connection",
      "label": "Verifying Jira connection...",
      "action": "mcp-test",
      "params": {
        "name": "atlassian",
        "expectedTool": "search_issues"
      }
    }
  ],
  "uninstall": [
    {
      "id": "remove-mcp",
      "label": "Removing Atlassian MCP server...",
      "action": "mcp-remove",
      "params": {
        "name": "atlassian",
        "scope": "global"
      }
    }
  ]
}
```

---

## Testing Your Plugin

### 1. Validate JSON Schemas

Ensure all three JSON files are valid:

```bash
# Using Node.js
node -e "JSON.parse(require('fs').readFileSync('plugin.json'))"
node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"
node -e "JSON.parse(require('fs').readFileSync('setup.json'))"
```

### 2. Test MCP Connection

If your plugin uses an MCP server, verify it responds:

```bash
# Add the MCP temporarily
claude mcp add --transport http --scope user --header="Authorization: Bearer YOUR_TOKEN" test-mcp https://your-mcp-url/

# Test with Claude CLI
echo "List all tools from the test-mcp MCP server" | claude --print

# Remove when done
claude mcp remove test-mcp --scope user
```

### 3. Test URL Pattern

Verify your `urlPattern` regex extracts the correct `workItemId`:

```javascript
const pattern = /https:\/\/pm\.example\.com\/.*\/requirement\/(?<workItemId>[a-f0-9-]+)/;
const url = "https://pm.example.com/project/abc/requirement/6b5ea05f-6d7f-4a7a-8f85-3e3accbab1f4";
const match = url.match(pattern);
console.log(match?.groups?.workItemId);
// "6b5ea05f-6d7f-4a7a-8f85-3e3accbab1f4"
```

### 4. Test Field Mapping

Verify JSONPath expressions extract the right data from your MCP responses:

```javascript
// Call your MCP tool and save the response, then test each fieldMap entry
const response = { title: "Fix bug", overview: "<p>Details</p>", acceptance_criteria: [{id: "1", description: "Works"}] };

// Test: "$.title" should give "Fix bug"
// Test: "$.acceptance_criteria[*].description" should give ["Works"]
```

### 5. Install Locally for Development

Copy your plugin to the plugins directory:

```bash
cp -r ./my-plugin/ ~/.config/agent-hub/plugins/my-plugin/
```

Then restart Agent Hub. The plugin should appear in the plugins list.

### 6. Check Logs

During workflow execution, plugin hook results are logged to the Agent Hub logs view. Look for:
- `[plugin:my-plugin] Hook on:workflow_started executed successfully`
- `[plugin:my-plugin] Hook on:quality_pass failed: MCP timeout`

---

## Summary

| What | Where | Format |
|------|-------|--------|
| Plugin identity & config form | `plugin.json` | JSON |
| Workflow hooks, operations, phases | `manifest.json` | JSON |
| Install/uninstall steps | `setup.json` | JSON |
| Complex platform adapters | `adapter/index.ts` | TypeScript (Level 2 only) |
| Plugin files storage | `~/.config/agent-hub/plugins/{id}/` | Directory |
| Plugin registry | `~/.config/agent-hub/plugins/installed.json` | JSON |
| Secrets | Agent Hub SQLite (encrypted) | Encrypted |

**To create a plugin, you need:**
1. Three JSON files (`plugin.json`, `manifest.json`, `setup.json`)
2. An MCP server for your service (or use an existing one)
3. Knowledge of your service's API responses (for `fieldMap`)
4. Optionally: an icon SVG and a README

**No compilation required** for Level 1 plugins. Just JSON.
