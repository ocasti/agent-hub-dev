# Changelog — Agent Hub

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [2.0.0] — 2026-03-09 — Multi-Agent Adapter System

### Added
- **Multi-Agent support**: Agent Hub supports Claude Code + Gemini CLI as verified agents. Architecture is extensible — new agents can be added via `GenericAgentDef` once tested end-to-end.
- **Agent Adapter pattern**: `AgentAdapter` interface abstracts agent differences (binary, flags, stdin protocol, env vars)
  - `ClaudeAdapter`: specialized adapter preserving exact Claude Code CLI behavior
  - `GenericAdapter`: config-driven adapter for all other agents via `GenericAgentDef`
  - Agent registry: `registerAgent()`, `getAgent()`, `getAllAgents()`, `getInstalledAgents()`
- **Tier-based agent configuration**:
  - **Free**: one global agent for ALL projects — changing updates every project immediately
  - **Registered**: global default + per-project override (single agent)
  - **Premium**: per-phase primary + fallback with automatic failover
- **Automatic failover** (Premium): if primary agent fails, retries with fallback agent
- **Agent resolution flow**: `project.ai_agent_phases[phase]` → `project.ai_agent` → `settings.default_ai_agent` → `'claude'`
- **Settings UI**: new "AI Agent" section with global/default agent selector, tier-aware labels, and installed agents list with version/status
- **ProjectForm UI**: agent dropdown (disabled for free), per-phase timeline pipeline with primary + fallback selectors (Premium only)
- **Health check**: detects all installed agent CLIs, Specify CLI (`specify version`), and per-agent SDD Kit status
- **Per-agent SDD Kit detection**: checks `~/{configFolder}/commands/speckit.specify.md` for each agent (not just Claude)
- **Agent validation before spawn**: verifies agent is installed before executing — auto-falls back to any installed agent if configured one is missing (prevents ENOENT crashes)
- **Agent prompt adaptation**: `transformPrompt()` hook per adapter for agent-specific prompt customization
- **Database migration 16**: `ai_agent` and `ai_agent_phases` columns on projects table

### Changed
- **Orchestrator**: all `runClaudePhase()` calls replaced with `runAgentPhase()` — agent-agnostic phase execution
- **Repo Analysis**: uses resolved agent instead of hardcoded Claude spawn — respects project agent config
- **PR Feedback**: uses adapter system for all 9 agent subprocess calls
- **Test Runner**: uses adapter system for test fix loops
- **Refine with AI**: uses resolved agent instead of hardcoded Claude
- **Health Check UI**: "AI Agent" (any installed) replaces "Claude Code CLI"; "Specify CLI (SDD Kit)" replaces "Speckit Commands"
- **Installed Agents UI**: two-column layout, sorted installed-first, shows SDD Kit status per agent (Ready / No SDD Kit / Not installed)
- **Prompt builder**: prompts documented as agent-agnostic; adapters customize via `transformPrompt()`
- **License system**: added `multi_agent_mode` field (`global_only` | `per_project` | `per_phase`)
- **SPEC.md**: updated F3 (Agent Execution) and F9 (Settings) for multi-agent support
- **Plugin docs**: noted that plugins interact with agent-agnostic hooks (no plugin API changes)
- **AGENT.md**: project context file renamed from `CLAUDE.md` to `AGENT.md` — agent-agnostic name for auto-generated project documentation

---

## [1.5.0] — 2026-03-09 — Worktrees V3: Auto-merge, Diff Viewer & Monorepo Support

### Added
- **Auto-merge on completion**: Worktree branches are automatically merged into the default branch when a task completes (no code-hosting plugin). Conflicts are detected and the branch is preserved for manual merge.
- **Conflict notifications**: When creating a worktree, overlapping files with other active branches are detected and a notification is sent to the user.
- **Worktree diff viewer**: New "Diff" button in the Dashboard worktree table shows an inline summary of changed files with additions/deletions per file and color-coded status indicators.
- **Monorepo support**: `detectMonorepoPackages()` detects workspaces from npm/yarn `package.json`, `pnpm-workspace.yaml`, and `lerna.json`. New IPC endpoint `worktree:monorepoPackages`.

### Fixed
- **Plugin install 404**: Added `plugin-registry/**/*` and `plugins/registry/**/*` to electron-builder `files` so bundled plugins are included in production builds. Fixes "Download failed with status 404" when installing the GitHub plugin.

### Removed
- Internal `docs/PLAN-WORKTREES.md` (not user-facing, removed from repo).

---

## [1.4.0] — 2026-03-09 — Worktrees V2: Conflict Detection, Symlinks & Dashboard

### Added
- **Conflict detection**: `detectWorktreeConflicts()` analyzes files modified in active worktree branches to detect potential overlaps before starting a new task
- **Symlink node_modules**: `setupWorktreeDepsWithSymlink()` tries symlinking node_modules from the main project before falling back to full install, saving ~500MB+ per worktree
- **Merge worktree branches**: Manual "Merge" action from Dashboard to integrate completed branches into the default branch with conflict detection
- **Worktree Dashboard**: Visual table showing all active worktrees with task name, project, branch, status, disk usage, and actions (Merge/Remove)
- **Configurable max_parallel_per_project**: Premium users can now configure the per-project parallel limit in Settings (1-3)
- **Worktree IPC handlers**: `worktree:list`, `worktree:detectConflicts`, `worktree:merge`, `worktree:remove`

### Changed
- Orchestrator uses `setupWorktreeDepsWithSymlink` instead of `setupWorktreeDeps` for disk-efficient dependency installation
- `getMaxParallelPerProject()` now respects user-configured setting (capped at tier max)
- Settings grid changed from 3-column to 4-column to accommodate "Parallel / Project" field

### Fixed
- Strip HTML from release notes in update alerts (backend + frontend)
- Skip version logic uses semver comparison — skipping v1.3.1 won't block v1.3.2+
- Download button shows immediate progress feedback; errors displayed in Dashboard
- Added electron-updater logging for diagnostics

---

## [1.1.0] — 2026-03-08 — Code Hosting Adapter System

### Added
- **CodeHostingAdapter interface**: abstraction layer for code hosting providers (GitHub, GitLab, Bitbucket)
  - `CodeHostingAdapter` interface: `buildEnvVars()`, `createPR()`, `fetchFeedback()`, `postReplies()`, `resolveThreads()`, `minimizeOldComments()`, `push()`
  - `GitHubAdapter` class: first implementation using `gh` CLI
  - Adapter registry: `getAdapter()`, `registerAdapter()` — extensible for future providers
- **Per-project credential overrides**: each project can override global plugin config (token, author name, author email, default branch)
  - New DB column: `projects.code_hosting_config` (migration 012)
  - Credential resolver: merges global plugin config with per-project overrides
  - `CodeHostingProjectConfig` interface in frontend types
- **Environment variable injection**: `GH_TOKEN`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` injected per subprocess
  - `cleanEnv(extraEnv?)` — merges extra env vars into subprocess environment
  - All `execFileAsync()`, `execGraphQL()`, `runClaudePhase()` accept optional `extraEnv`
  - All git-ops functions (`prepareGitBranch`, `commitWipIfDirty`, `getDefaultBranch`) accept optional `extraEnv`
  - Supports concurrent tasks with different accounts (no global `gh auth switch`)
- **Project credential UI**: "Project Credentials" section in ProjectForm when code hosting plugin is active
  - Token (password field), Git Author Name, Git Author Email — all optional overrides
- **GitHub plugin configSchema**: added `token`, `authorName`, `authorEmail` fields (global config)

### Changed
- **GitHub plugin**: version 1.0.0 → 1.1.0 with new configSchema fields
- **Orchestrator**: resolves env vars at workflow start, passes `extraEnv` to all subprocess calls
- **PR Feedback**: resolves env vars for both `runFetchAndFix()` and `runFetchAndFixPushOnly()`
- **github-api.ts**: all 5 functions accept optional `extraEnv` parameter, passed to all `execFileAsync`/`execGraphQL` calls

---

## [1.0.0] — Plugin System

### Added
- **Plugin architecture**: capability-based plugin system for extending Agent Hub without modifying core code
- **Plugin types**: declarative (JSON manifest + MCP) and adapter (TypeScript modules)
- **Plugin installer**: wizard-based UI with auto-configuration of MCP servers
- **Dynamic workflow**: core phases (0-3) are fixed; plugins can add optional phases and hooks
- **Hook system**: plugins subscribe to workflow events (`on:plan_approved`, `on:quality_pass`, etc.)
- **Plugin categories**: Code Hosting, PM Tools, Notifications, and any future integration
- **Plugin manifest schema**: `plugin.json`, `manifest.json`, `setup.json`
- **Plugin documentation**: `docs/PLUGIN-DEVELOPMENT.md` — complete guide to create plugins
- **Dynamic config fields**: `configSchema` fields with `source` property load options from MCP servers at runtime
- **MCP client**: generic HTTP client for MCP Streamable HTTP transport with session management
- **Task Fields system**: plugins declare `taskFields` in `plugin.json` to inject dynamic fields into TaskForm
  - Declarative positioning: `before:title`, `after:project`, `form.start`, `form.end`, etc.
  - Searchable select with `source` that loads options from plugin MCP operations
  - `onSelect.fetch` calls a detail operation when user selects an item
  - `onSelect.fill` auto-completes task form fields (title, description, criteria) from fetched data
  - Fully agnostic: works with any PM tool (Jira, Linear, Asana, etc.) — only JSON changes
- **Plugin operation execution**: new IPC endpoints `plugins:executeOperation` and `plugins:getTaskFields`

### Changed
- **Workflow engine**: refactored from hardcoded 6 phases to dynamic core (4 phases) + plugin phases
- **Code Hosting**: GitHub-specific code (`github-api.ts`, `pr-feedback.ts`) moved to GitHub plugin adapter
- **Architecture docs**: updated `ARCHITECTURE.md` to reflect Electron stack (was outdated with Tauri references)
- **CLAUDE.md**: updated project structure and workflow documentation
- **SPEC.md**: added plugin system features (F10, F11)

### Fixed
- **macOS PATH fix**: Electron apps launched from Finder now inherit the user's full shell PATH

---

## [1.0.0] — 2026-03-07 — Baseline

### Features
- SDD Workflow Engine: 6-phase orchestration (Spec Review → Plan → Implement → Quality Gate → Ship → PR Feedback)
- Project management: CRUD with local path, GitHub repo, optional skills
- Task management: CRUD with specs, acceptance criteria, images, model selection
- Claude Code CLI integration: subprocess execution with real-time log streaming
- GitHub integration: PR creation, review thread fetching, thread resolution, comment cleanup
- Git operations: automatic branch creation, WIP commits, branch switching
- Skills management: global and per-project skill toggles (reads/writes Claude Code settings.json)
- Knowledge base: pattern detection, SQLite storage, MD export, prompt injection
- Quality Gate: automated review loop with configurable max iterations
- PR Feedback: Fetch & Fix cycle with thread-level comment handling
- Dashboard: active agents, action-required tasks, recent activity
- Workflow view: visual diagram of SDD phases
- Logs: real-time streaming with project filtering
- Settings: concurrent agents, default model, review loops, health check
- i18n: English and Spanish
- Test runner: native test detection and execution
- Repo analysis: auto-generates AGENT.md for new projects
- AI-assisted refinement: "Refine with AI" for task descriptions and acceptance criteria
