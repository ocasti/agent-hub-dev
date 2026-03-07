# SPEC.md — Agent Hub v1.0

## Overview

Agent Hub is a desktop application (Electron) that orchestrates SDD development using Claude Code CLI. It allows creating projects, defining tasks with specs, running agents that follow the SDD cycle, and learning from code reviews.

## Features

### F1: Project Management

**Description**: CRUD for development projects. Each project has a name, local path, GitHub repo, description (project context), and optional skills.

**Acceptance Criteria**:
- Create project with: name, local path, GitHub repo (optional), description
- Edit all fields of an existing project
- Delete project (with confirmation)
- Optional skills selector grouped by category
- Preview of the .claude/settings.json file that would be generated
- Project description is injected into every task as context

**Data**:
```typescript
interface Project {
  id: string;
  name: string;
  path: string;              // Local project path
  repo?: string;             // org/repo on GitHub
  description: string;       // Context: stack, domain, conventions
  optionalSkills: string[];  // Active optional skill IDs
  createdAt: string;
  updatedAt: string;
}
```

### F2: Task Management

**Description**: CRUD for development tasks associated with a project. Each task is an SDD spec.

**Acceptance Criteria**:
- Create task with: project, title, spec/description, acceptance criteria, images, model (sonnet/opus)
- List tasks grouped by project
- View full task detail (spec, criteria, skills, logs, progress)
- Edit task with warnings based on status:
  - Queued: free editing
  - PR Feedback: yellow warning (code exists, full re-execution)
  - Completed: red warning (will be reopened)
- Delete task in queued status
- Start task execution (play button)
- PR Feedback buttons: "Fetch & Fix" and "Approve"

**Data**:
```typescript
interface Task {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  description: string;         // The spec
  acceptanceCriteria: string[];
  images: { url: string }[];
  model: 'sonnet' | 'opus';
  status: TaskStatus;
  prNumber?: number;
  reviewCycle: number;
  specSuggestions?: string[];  // Phase 0 suggestions
  branchName?: string;
  createdAt: string;
  updatedAt: string;
}

type TaskStatus =
  | 'queued'
  | 'spec_review'     // Phase 0: analyzing spec
  | 'spec_feedback'   // Phase 0: paused for spec refinement
  | 'planning'        // Phase 1
  | 'implementing'    // Phase 2
  | 'reviewing'       // Phase 3
  | 'fixing'          // Phase 3: fixing issues
  | 'shipping'        // Phase 4
  | 'pr_feedback'     // Phase 5: waiting for human review
  | 'pr_fixing'       // Phase 5: fixing PR feedback
  | 'completed'
  | 'failed';
```

### F3: Agent Execution (Claude Code CLI)

**Description**: Run Claude Code CLI as a subprocess with cwd set to the project path. Real-time output streaming.

**Acceptance Criteria**:
- Execute `claude` CLI with the constructed prompt (spec + criteria + knowledge + project context)
- Stream stdout line by line to the renderer via IPC
- Concurrency control (max simultaneous agents, configurable)
- Handle the 6 SDD workflow phases
- Phase 0 (Spec Review): analyze spec, pause if incomplete with suggestions
- Phase 5 (PR Feedback): pause after Ship, manual buttons
- Health check on startup (claude --version, gh --version)
- Model selection (sonnet/opus) per task

**Base command**:
```bash
claude --model claude-sonnet-4-5-20250929 --print "prompt..."
# Executed with cwd = project.path
```

### F4: Skills Management

**Description**: Read and write Claude Code configuration files to manage skills.

**Acceptance Criteria**:
- Read global skills from ~/.claude/settings.json → settingSources[]
- Read per-project skills from {project.path}/.claude/settings.json
- Toggle ON/OFF for global and per-project skills
- Add new skill by URL (org/skill-name)
- Preview of the JSON that will be written
- Explanatory panel on how it works

**Files read/written**:
```
~/.claude/settings.json                    → Global skills
{project.path}/.claude/settings.json       → Project skills
```

### F5: Knowledge Base (Learning System)

**Description**: Register code review patterns to inject them into future tasks.

**Acceptance Criteria**:
- Register pattern when ia-reviewer or human finds an issue
- Categorize by: security, testing, architecture, standards, performance
- Severity: critical, high, medium, low
- Store: title, description, code_example, anti_pattern
- Export to .md per project
- Inject knowledge into future task prompts
- View to browse, filter, and edit entries
- Counter for times_applied
- Mark as auto_fixable

### F6: Dashboard

**Description**: Main view with a summary of the entire system state.

**Acceptance Criteria**:
- Counters: active agents, require action (spec_feedback + pr_feedback), queued, completed, projects
- Active agents with real-time progress bar
- "Spec Needs Refinement" section (tasks in spec_feedback)
- "Waiting for PR Review" section (tasks in pr_feedback)
- Recent activity log

### F7: Workflow View

**Description**: Visual diagram of the 6-phase SDD workflow.

**Acceptance Criteria**:
- Show all 6 phases with their steps
- Badges: "Auto or pause if incomplete" (Phase 0), "Automatic loop" (Phase 3), "Manual" (Phase 5)
- Detail of the Fetch & Fix flow
- Detail of the IA Reviewer checklist

### F8: Logs

**Description**: System activity view with filtering.

**Acceptance Criteria**:
- Log list with timestamp, project, message, type (step/ok/error/info)
- Stored in SQLite
- Filter by project
- Auto-scroll
- Pagination or virtualization for large log volumes

### F9: Settings

**Description**: General application configuration.

**Acceptance Criteria**:
- Max concurrent agents (1-5)
- Default model (sonnet/opus)
- Max review loops (1-10)
- Health check: claude CLI, gh CLI, git status
- Environment info: core skills, DB path

## Visual Design

- Fixed left sidebar with navigation + counters
- Main area with scroll
- Color scheme: grays base, indigo primary, emerald success, amber warning, red error, purple review, cyan spec, pink PR feedback
- Font: system font stack
- Responsive not required (desktop app)
- Complete visual reference: see REFERENCE-UI.jsx

## Technical Constraints

- Electron main process: SQLite, subprocess, filesystem
- Electron renderer: React, UI only
- IPC bridge: preload.ts exposes secure API
- NEVER nodeIntegration: true
- NEVER contextIsolation: false
- SQLite synchronous in main, async IPC to renderer
- Agent concurrency: semaphore in main process
