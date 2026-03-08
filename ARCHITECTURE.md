# Agent Hub — Architecture

## Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | Electron | Cross-platform desktop (macOS, Linux, Windows) |
| **Frontend** | React 19 + TypeScript + TailwindCSS + Vite | UI components, state, styling |
| **Database** | SQLite (better-sqlite3) | Local persistent storage |
| **CLI Integration** | Claude Code CLI (subprocess) | AI-powered code generation |
| **Plugin Transport** | MCP (Model Context Protocol) | Universal integration layer |
| **Real-time** | Electron IPC (main → renderer) | Log streaming, phase updates |

---

## System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                      ELECTRON WINDOW                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │          React + TailwindCSS (Renderer)                 │  │
│  │                                                        │  │
│  │  Dashboard │ Tasks │ Projects │ Workflow │ Plugins │ ...│  │
│  │                                                        │  │
│  │  TaskForm: PM select/URL → Refine with AI              │  │
│  │  ProgressBar: dynamic phases from core + plugins       │  │
│  └──────────────────┬─────────────────────────────────────┘  │
│                     │ IPC (preload.ts bridge)                 │
│  ┌──────────────────▼─────────────────────────────────────┐  │
│  │              Main Process (Node.js)                     │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │           SDD Workflow Engine (core)              │  │  │
│  │  │                                                  │  │  │
│  │  │  Phase 0: Spec Review                            │  │  │
│  │  │  Phase 1: Plan                                   │  │  │
│  │  │  Phase 2: Implement                              │  │  │
│  │  │  Phase 3: Quality Gate                           │  │  │
│  │  │           ↓                                      │  │  │
│  │  │  [core_complete] → Plugin phases (if any)        │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                        │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │  │
│  │  │ Plugin       │ │ Claude CLI   │ │ SQLite       │  │  │
│  │  │ Engine       │ │ Runner       │ │ Database     │  │  │
│  │  │              │ │              │ │              │  │  │
│  │  │ Loads        │ │ spawn()      │ │ Projects     │  │  │
│  │  │ manifests,   │ │ --print      │ │ Tasks        │  │  │
│  │  │ fires hooks, │ │ --model      │ │ Runs, Logs   │  │  │
│  │  │ resolves     │ │ bypass perms │ │ Knowledge    │  │  │
│  │  │ templates    │ │ stdin prompt │ │ Settings     │  │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   ~/.config/          Local projects         ~/.claude.json
   agent-hub/          /path/to/project       (MCP servers)
   plugins/
```

---

## Project Structure

```
agent-hub/
├── CLAUDE.md                          # Project instructions for Claude Code
├── ARCHITECTURE.md                    # This file
├── SPEC.md                            # Formal feature specs
├── CHANGELOG.md                       # Version history
├── REFERENCE-UI.jsx                   # Visual prototype reference
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
│
├── docs/
│   └── PLUGIN-DEVELOPMENT.md         # Complete plugin creation guide
│
├── electron/
│   ├── main.ts                        # Electron main process + PATH fix
│   ├── preload.ts                     # IPC bridge (main ↔ renderer)
│   ├── ipc/
│   │   ├── agent/                     # SDD workflow engine
│   │   │   ├── index.ts              # IPC handler registration + health check
│   │   │   ├── orchestrator.ts       # Core 4-phase workflow + plugin phase dispatch
│   │   │   ├── claude-cli.ts         # Claude CLI execution (spawn, stdin prompt)
│   │   │   ├── prompt-builder.ts     # Enriched prompt construction
│   │   │   ├── output-parser.ts      # Phase output parsing
│   │   │   ├── git-ops.ts           # Branch, commit, WIP operations
│   │   │   ├── pr-feedback.ts       # Fetch & Fix cycle (uses code-hosting adapter)
│   │   │   ├── test-runner.ts       # Native test detection & execution
│   │   │   ├── repo-analysis.ts     # Project analysis & CLAUDE.md reading
│   │   │   ├── state.ts            # Resolver maps, abort controllers, waiters
│   │   │   ├── types.ts            # Shared interfaces & constants
│   │   │   └── adapters/            # Code hosting adapter pattern
│   │   │       ├── types.ts         # CodeHostingAdapter interface & types
│   │   │       ├── github.ts        # GitHub adapter (gh CLI)
│   │   │       ├── registry.ts      # Adapter registry & credential resolver
│   │   │       └── index.ts         # Public API re-exports
│   │   ├── plugins/                  # Plugin system
│   │   │   ├── loader.ts            # Read & parse plugin manifests
│   │   │   ├── engine.ts            # Hook dispatch, template resolution, MCP calls
│   │   │   ├── installer.ts         # Install/uninstall wizard logic
│   │   │   └── types.ts             # Plugin interfaces
│   │   ├── tasks.ts                  # Task CRUD
│   │   ├── projects.ts               # Project CRUD
│   │   ├── skills.ts                 # Read/write Claude Code settings.json
│   │   ├── knowledge.ts              # Knowledge base CRUD
│   │   └── dialog.ts                 # Native dialog handlers
│   └── db/
│       ├── index.ts                   # SQLite connection + migrations
│       ├── migrations.ts              # SQL migration runner
│       └── queries.ts                 # Prepared statements
│
├── src/
│   ├── App.tsx                        # Main app + routing
│   ├── main.tsx                       # React entry point
│   ├── index.css                      # Tailwind imports
│   ├── components/
│   │   ├── Sidebar.tsx               # Navigation + counters
│   │   ├── Dashboard.tsx             # Active agents, action-required, activity
│   │   ├── TasksView.tsx             # Task list + filters
│   │   ├── TaskDetail.tsx            # Full task view + plugin actions
│   │   ├── TaskForm.tsx              # Task creation/edit + PM select + Refine AI
│   │   ├── ProjectsView.tsx          # Project list
│   │   ├── ProjectForm.tsx           # Project creation/edit + plugin config
│   │   ├── WorkflowView.tsx          # Visual SDD phases (dynamic from plugins)
│   │   ├── PluginsView.tsx           # Plugin store, install, configure
│   │   ├── SkillsView.tsx            # Global/project skill toggles
│   │   ├── KnowledgeView.tsx         # Knowledge base browser
│   │   ├── LogsView.tsx              # Real-time log stream
│   │   ├── SettingsView.tsx          # App configuration
│   │   └── ui/                       # Reusable UI components
│   │       ├── Badge.tsx
│   │       ├── SkillTag.tsx
│   │       └── ProgressBar.tsx       # Dynamic phases from core + plugins
│   ├── lib/
│   │   ├── ipc.ts                    # Frontend IPC wrappers
│   │   ├── types.ts                  # TypeScript interfaces
│   │   ├── skills.ts                 # Skill catalog definitions
│   │   └── workflow.ts               # Workflow phase definitions
│   └── hooks/
│       └── useAgentLogs.ts           # Real-time log streaming hook
│
├── plugins/
│   └── registry/                     # Built-in plugin manifests
│       └── github/                   # Default code-hosting plugin
│
├── database/
│   └── migrations/
│       ├── 001_initial.sql
│       ├── 002_knowledge.sql
│       ├── 003_review_patterns.sql
│       └── 004_plugins.sql           # Plugin-related columns
│
└── public/
    ├── icon.png
    └── icon.svg
```

---

## SDD Workflow — Dynamic Phases

The workflow has two layers: **core phases** (always present) and **plugin phases** (added by active plugins).

### Core Phases (fixed)

```
Phase 0 — Spec Review
  ├── hook: on:before_spec (enrichment — PM plugin can inject requirement data)
  ├── Claude analyzes spec
  ├── If incomplete → hook: on:spec_needs_input → pause with suggestions → user edits/accepts
  └── hook: on:spec_complete

Phase 1 — Plan
  ├── Claude decomposes into subtasks
  ├── hook: on:plan_ready (plan generated, awaiting approval)
  ├── Plan review gate → user approves or re-plans
  └── hook: on:plan_approved (PM plugin can create dev_tasks)

Phase 2 — Implement
  ├── Git: prepare feature branch
  ├── Claude implements with TDD
  └── hook: on:implement_complete (PM plugin can mark subtasks done)

Phase 3 — Quality Gate (loop)
  ├── hook: on:review_started (each review iteration)
  ├── Claude reviews code quality
  ├── If pass → hook: on:quality_pass (PM plugin can mark criteria met)
  ├── If fail → hook: on:quality_fail (PM plugin can create QA issue)
  ├── Fix → re-review (up to maxReviewLoops)
  ├── If max loops → hook: on:quality_max_loops
  └── hook: on:core_complete
```

### Plugin Phases (dynamic, from code-hosting plugin)

```
Phase 4 — Ship (capability: "ship")
  ├── hook: on:ship_started
  ├── Conventional commit + push + create PR/MR
  ├── If fail → hook: on:ship_failed
  ├── hook: on:pr_created (PM → status "In Review", Notify → message)
  └── Pause: waiting for human review

Phase 5 — PR Feedback (capability: "pr_feedback")
  ├── User clicks "Fetch & Fix" or "Approve"
  ├── If comments → hook: on:pr_changes_requested → Claude fixes → re-push → hook: on:pr_fix_pushed
  ├── hook: on:pr_approved (PM → status "Done", Notify → message)
  └── hook: on:task_complete (all plugins react)
```

### Lifecycle Hooks

```
on:workflow_started  — fired when the SDD workflow begins
on:task_complete     — fired when task completes (Phase 3 or PR approved)
on:workflow_failed   — fired on unrecoverable error
on:workflow_aborted  — fired when user stops the agent
```

### Without Plugins

If no code-hosting plugin is active, the workflow ends at Phase 3 (core_complete). The task is marked as completed after Quality Gate passes. The user handles git/PR manually.

---

## Plugin System

See [docs/PLUGIN-DEVELOPMENT.md](docs/PLUGIN-DEVELOPMENT.md) for the complete plugin creation guide.

### Key Concepts

- **Plugins are declarative** (JSON manifests) — no code required for Level 1
- **MCP is the transport layer** — plugins call MCP tools configured in Claude Code
- **Capability-based conflict resolution** — only one plugin per capability per project
- **Hook-only plugins never conflict** — multiple can coexist (Slack + Teams + GDrive)
- **Dynamic workflow** — phases and hooks are resolved per-project based on active plugins

### Plugin Contributions

| Contribution | What it does | Example |
|-------------|-------------|---------|
| **Hooks** | React to workflow events | PM: mark task done on completion |
| **Phases** | Add phases to workflow | GitHub: Ship + PR Feedback phases |
| **Enrichment** | Inject data into existing phases | PM: pre-fill specs from requirement |
| **Actions** | Add manual buttons to UI | "Sync with PM", "Export to Drive" |
| **Operations** | Reusable MCP tool call templates | `listMyWork`, `fetch`, `updateStatus` |
| **Task Fields** | Inject dynamic fields into TaskForm | PM: searchable requirement selector with auto-fill |

### Storage

```
~/.config/agent-hub/plugins/     # Installed plugin files
~/.config/agent-hub/plugins/installed.json  # Plugin registry
~/.claude.json                   # MCP server configurations
Agent Hub SQLite                 # Encrypted secrets, per-project plugin config
```

---

## Database Schema

### Core Tables

- **projects**: id, name, path, repo, description, optional_skills, test_command, code_hosting, code_hosting_config, plugin_pm, plugin_pm_config
- **tasks**: id, project_id, title, description, acceptance_criteria, images, model, status, pr_number, review_cycle, spec_suggestions, plan_summary, branch_name, criteria_status, pm_work_item_id, pm_work_item_url
- **agent_runs**: id, task_id, phase, started_at, finished_at, result, output, error_output
- **logs**: id, task_id, project_name, message, kind, created_at
- **knowledge_entries**: id, project_id, category, severity, title, description, source_task, source_pr, code_example, anti_pattern, tags, times_applied
- **review_patterns**: id, knowledge_id, task_id, reviewer, issue_found, fix_applied, phase, auto_fixable
- **settings**: key, value

### Plugin Columns (migration 010)

```sql
ALTER TABLE projects ADD COLUMN code_hosting TEXT DEFAULT NULL;
ALTER TABLE projects ADD COLUMN plugin_pm TEXT DEFAULT NULL;
ALTER TABLE projects ADD COLUMN plugin_pm_config TEXT DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN pm_work_item_id TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN pm_work_item_url TEXT DEFAULT NULL;
```

### Code Hosting Config (migration 012)

```sql
ALTER TABLE projects ADD COLUMN code_hosting_config TEXT DEFAULT '{}';
-- Stores per-project credential overrides: { token, authorName, authorEmail, defaultBranch }
```

---

## Claude CLI Integration

Agent Hub executes Claude Code CLI as a subprocess:

```
claude --model {sonnet|opus} --print --permission-mode bypassPermissions
```

- Prompt is sent via **stdin** (avoids shell escaping and arg length limits)
- Output is streamed **line by line** via stdout → IPC → renderer
- MCP servers from `~/.claude.json` are automatically available
- `cleanEnv(extraEnv?)` strips `CLAUDECODE` env var and injects per-project credentials
- macOS PATH fix ensures CLI tools are found when launched from Finder

---

## Code Hosting Adapter System

The adapter system abstracts code hosting operations (GitHub, GitLab, Bitbucket) behind a common interface, enabling multi-provider and multi-account support.

### Architecture

```
┌─────────────────────────────────────┐
│         Orchestrator / PR Feedback   │
│                                     │
│  resolveEnvVars(projectId, db)      │
│  → { GH_TOKEN, GIT_AUTHOR_NAME, …} │
│                                     │
│  All subprocess calls get extraEnv  │
└──────────────┬──────────────────────┘
               │
    ┌──────────▼──────────┐
    │   Adapter Registry   │
    │                      │
    │  resolveCredentials()│
    │  = global config     │
    │  + project override  │
    └──────────┬──────────┘
               │
    ┌──────────▼──────────┐
    │ CodeHostingAdapter   │
    │ (interface)          │
    │                      │
    │ buildEnvVars()       │
    │ createPR()           │
    │ fetchFeedback()      │
    │ postReplies()        │
    │ resolveThreads()     │
    │ minimizeOldComments()│
    │ push()               │
    └──────────┬──────────┘
               │
    ┌──────────▼──────────┐
    │   GitHubAdapter      │ ← Future: GitLabAdapter, BitbucketAdapter
    │   (gh CLI)           │
    └─────────────────────┘
```

### Credential Resolution

Per-project credentials override global plugin config:

1. **Global**: `installed.json` → plugin config (`token`, `authorName`, `authorEmail`)
2. **Per-project**: `projects.code_hosting_config` column (`{ token, authorName, authorEmail, defaultBranch }`)
3. **Merge**: project values take precedence over global

### Environment Variable Injection

Credentials are converted to env vars and injected into every subprocess:

| Adapter | Token var | Author vars |
|---------|-----------|-------------|
| GitHub | `GH_TOKEN` | `GIT_AUTHOR_NAME`, `GIT_COMMITTER_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_EMAIL` |
| GitLab (future) | `GITLAB_TOKEN` | Same git vars |
| Bitbucket (future) | `BITBUCKET_TOKEN` | Same git vars |

This enables concurrent tasks with different accounts — no global `gh auth switch` needed.

---

## Key Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Framework | Electron | Full Node.js access for SQLite, subprocess, filesystem |
| Database | SQLite (better-sqlite3) | Local, no server, sync in main process |
| CLI execution | child_process.spawn | Direct subprocess, stdin for prompt, streamed output |
| Plugin system | Declarative JSON + MCP | Extensible without code changes, universal transport |
| Code hosting | Level 2 adapter (TS) + per-project env vars | Platform APIs too different for declarative config; env var injection enables multi-account |
| PM integration | Level 1 declarative (JSON) | MCP normalizes different PM APIs |
| Real-time logs | Electron IPC events | Native, no WebSocket overhead |
| Skills | Read/write settings.json | Direct integration with Claude Code configuration |
| i18n | i18next | English and Spanish |

---

## User Prerequisites

1. **Claude Code CLI** — installed and authenticated (`claude login`)
2. **Git** — configured with user name and email
3. **Node.js 20+** — required for Electron
4. **Code Hosting CLI** (optional) — `gh` for GitHub, `glab` for GitLab, etc.
5. **MCP servers** (optional) — configured via plugins for PM tools, etc.
