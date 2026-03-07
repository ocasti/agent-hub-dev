# Changelog — Agent Hub

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] — Plugin System

### Added
- **Plugin architecture**: capability-based plugin system for extending Agent Hub without modifying core code
- **Plugin types**: declarative (JSON manifest + MCP) and adapter (TypeScript modules)
- **Plugin installer**: wizard-based UI with auto-configuration of MCP servers
- **Dynamic workflow**: core phases (0-3) are fixed; plugins can add optional phases and hooks
- **Hook system**: plugins subscribe to workflow events (`on:plan_approved`, `on:quality_pass`, etc.)
- **Plugin categories**: Code Hosting, PM Tools, Notifications, and any future integration
- **Plugin manifest schema**: `plugin.json`, `manifest.json`, `setup.json`
- **Plugin documentation**: `docs/PLUGIN-DEVELOPMENT.md` — complete guide to create plugins

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
- Repo analysis: auto-generates CLAUDE.md for new projects
- AI-assisted refinement: "Refine with AI" for task descriptions and acceptance criteria
