# Changelog — Agent Hub

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] — Stability & Security Hardening

Findings from a full audit of the workflow engine, git layer, plugin system,
database/IPC surface and frontend.

### Fixed — broken behaviour
- **Production build was failing on `main`**: `src/App.tsx` initial `Settings` was missing `tasksFilterProjects`/`tasksFilterStatuses`. Added a `typecheck` script, since the root `tsconfig.json` uses `"files": []` and a plain `tsc --noEmit` verified nothing
- **Premium agent failover never triggered**: adapters *resolve* with a non-zero exit code on CLI failure and timeout, so the fallback (which only ran on rejection) covered just a missing binary. Failover now also handles non-zero exits, while still ignoring user aborts
- **Editing a spec and continuing always threw**: the resume path called the 14-parameter `updateTask` with 12 values, failing the task and discarding the edited spec
- **Ship phase hardcoded `gh pr create`** regardless of provider — Bitbucket projects tried to ship through the GitHub CLI. The command now comes from the project's adapter (`prCreateCommand`/`prTerm`)
- **Quality gate could pass without a review passing**: verdict markers were matched anywhere in the transcript, including where agents echo the prompt's own "Required Output Format". Verdicts are now read from the tail only, and contradictory markers fail closed
- **`knowledge:create` returned the wrong record**, looking rows up by project id instead of entry id
- **Scheduled license revalidation never ran**: `ipcMain.emit` does not invoke an `ipcMain.handle` handler
- **Ship with no PR number** no longer enters PR Feedback, a state the task could never leave
- Regression context was silently empty on repos whose default branch is not main/master/develop
- Fixed a `.then()` chained after `.catch()` that logged "Closed PR" even when closing failed

### Fixed — data loss
- **Rejecting a push ran `git clean -fd`** in the working directory — which, without a worktree, is the user's own project, deleting every untracked file including local `.env`. Now only tracked changes are reverted, and remaining untracked files are reported
- **Editing plugin config destroyed stored tokens**: the form echoed the masked value (`••••••abc`) back and overwrote the secret. Masked values are now treated as unchanged
- **`~/.claude/settings.json` could be wiped**: a parse failure fell back to `{}` and rewrote the file, destroying permissions, hooks and model config. Invalid JSON is now an error; writes are atomic (temp + rename) with a `.bak`
- **The restart path bulk-resolved every open PR thread** without replies. It now pushes and leaves threads for the reviewer

### Security
- **Hosting tokens are no longer passed to AI agent subprocesses** (`resolveAgentEnvVars`); agents run shell commands over untrusted reviewer text, so a token in their environment was exfiltratable by prompt injection. Author identity is preserved
- **Git plumbing moved out of the LLM**: squash/commit/push run via `execFile` with argv arrays (`squashAndPush`, `commitAllIfStaged`). Review text interpolated into `git commit -m "…"` prompts was a command-injection vector
- **`validateProjectPath` was a no-op** (every absolute path passed); paths are now resolved, symlink-checked and required to be registered projects
- Electron window hardened: `sandbox: true`, `setWindowOpenHandler` deny, `will-navigate` guard
- `dialog:openExternal` restricted to http/https
- Plugin ids validated before use as a path segment (uninstall does a recursive delete on that directory)
- MCP requests now time out after 30s; a hung server could freeze a blocking hook forever

### Stability
- **Process supervisor**: agent subprocesses are tracked and terminated on quit (SIGTERM then SIGKILL) instead of being orphaned mid-edit; stdin errors are handled so an EPIPE can't take down the main process
- **Startup reconciliation** requeues tasks left mid-flight by a crash, which previously consumed a concurrency slot forever
- **Re-entrancy guard** on `agent:run`: a duplicate start overwrote the AbortController, making the first run unstoppable while two agents shared a working directory
- `push_review` no longer counts toward the global concurrency limit
- Malformed JSON in a single row no longer blanks entire views (`safeJsonParse`)
- Task activity log filters by task id, not project name — parallel tasks interleaved their output
- Failed start/push actions now surface an error instead of silently doing nothing

### Changed
- Added `patchTask`, a named-parameter task update, replacing positional 14-argument calls whose call sites had drifted
- Task status taxonomy (`RUNNING_STATUSES`, `PAUSED_STATUSES`, `NON_RUNNING_STATUSES`) centralised in one place instead of being inlined in several queries and components
- Added regression tests for verdict parsing and `patchTask` (68 tests, up from 55)

---

## [2.5.0] — 2026-03-11 — Strict Multi-Agent Resolution & Project-Level Model

### Added
- **Exit code interpretation for non-Claude agents**: Gemini CLI exit code 1 with valid SDD markers in output is treated as success; fatal codes (41/42/44/52) always fail; turn limit (53) checks output before deciding
- **`fatalExitCodes` and `turnLimitExitCode`** fields on `GenericAgentDef`
- **Database migration 19**: `default_model` column on projects table

### Changed
- **Strict agent resolution**: the configured agent is now strictly respected — no silent fallback to Claude when the agent ID is not found or not installed; if the primary is missing, only the *configured* fallback is tried, otherwise the run fails with a clear error
- **Model selector moved from TaskForm to ProjectForm** (sonnet/opus): shown only for Claude in single-agent mode; per-phase config defaults to sonnet

### Removed
- Dead `runClaudePhase()` code from `claude-cli.ts`

---

## [2.4.0] — 2026-03-11 — Bitbucket Plugin, Jira Plugin & Adapter Decoupling

### Added
- **Bitbucket code hosting plugin** (Level 2): full Ship + PR Feedback workflow via `bkt` CLI — supports Cloud and Data Center
- **Jira PM plugin** (Level 1 declarative): issue sync, status transitions, workflow comments, and spec enrichment via `mcp-atlassian` MCP server — supports Cloud and Data Center
- **Task list multi-select filters**: filter by multiple projects and statuses simultaneously, with persistence across sessions
- **`closePR` adapter method**: close/decline PRs through the adapter instead of hardcoded `gh` calls
- **`cleanupOldComments` adapter method**: provider-specific old comment cleanup through the adapter
- **`*Full` adapter methods**: `fetchFeedbackFull`, `postRepliesFull`, `resolveThreadsFull`, `minimizeOldCommentsFull` with built-in logging

### Changed
- **PR Feedback fully decoupled**: removed all direct `github-api` imports from `pr-feedback.ts` — everything routes through `CodeHostingAdapter`
- **Dynamic adapter registry**: adapters are lazy-instantiated and only available when their plugin is installed and enabled (replaced hardcoded map)
- **Task re-queue PR close**: uses adapter instead of hardcoded `gh pr close`

### Fixed
- Bundled catalog now stays in sync with generated catalog

---

## [2.1.0] — 2026-03-10 — Branch Sync & Plugin Enrichment

### Added
- **Sync Remote button** (PR Feedback phase): pulls changes from the remote branch when commits were pushed outside the app
- **Sync Parent button** (PR Feedback phase): merges parent branch (main/master/develop) into the feature branch; if merge conflicts arise, the AI agent resolves them automatically
- **Plugin hook enrichment**: PM plugins can now inject requirement data into Phase 0 (spec review) prompts via `on:before_spec` enrichment
- **Real MCP dispatch for hooks**: plugin hook operations now execute via actual MCP tool calls with template variable resolution
- **Plugin context in orchestrator**: plugin-injected subtasks and criteria are passed through the full workflow pipeline

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
