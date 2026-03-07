# SETUP.md — Instructions for Claude Code

## How to use these files

These files contain all the context needed for Claude Code to initialize the Agent Hub project from scratch.

### Step 1: Create the project folder

```bash
mkdir -p ~/projects/agent-hub
cp CLAUDE.md ARCHITECTURE.md SPEC.md MIGRATIONS.sql REFERENCE-UI.jsx ~/projects/agent-hub/
cd ~/projects/agent-hub
```

### Step 2: Start Claude Code

```bash
claude
```

### Step 3: Give the initial instruction

Paste this into Claude Code:

```
Initialize the Agent Hub project. Read CLAUDE.md, SPEC.md, and ARCHITECTURE.md to understand the full context.

The project is an Electron + React + TypeScript + Vite + TailwindCSS + SQLite (better-sqlite3) app.

Steps:
1. Initialize with npm create vite@latest . -- --template react-ts
2. Configure Electron (main.ts, preload.ts)
3. Configure TailwindCSS
4. Configure SQLite with better-sqlite3
5. Create the folder structure per CLAUDE.md
6. Implement SQL migrations (MIGRATIONS.sql)
7. Implement React components using REFERENCE-UI.jsx as visual reference
8. Implement IPC handlers for CRUD and Claude CLI execution

The REFERENCE-UI.jsx file is a functional React prototype with all the UI already designed. Use it as reference but implement with the real architecture (separate components, TypeScript, SQLite, Electron IPC).
```

### Included Files

| File | Contents |
|---|---|
| `CLAUDE.md` | Full project context, stack, structure, rules |
| `SPEC.md` | Formal SDD spec with all features and criteria |
| `ARCHITECTURE.md` | Technical architecture, diagrams, code examples (adapt to Node.js/Electron) |
| `MIGRATIONS.sql` | Complete SQLite schema with all 6 tables |
| `REFERENCE-UI.jsx` | Functional React prototype (~1200 lines) with the full UI |
| `SETUP.md` | This file |

### Important Notes

- ARCHITECTURE.md was originally written for Tauri (Rust). Electron was chosen instead. The concepts apply equally but the backend is Node.js instead of Rust.
- REFERENCE-UI.jsx uses `useReducer` in memory. The real version must use SQLite via IPC.
- REFERENCE-UI.jsx uses `useSim()` to simulate agents. The real version must execute the `claude` CLI as a subprocess.
- The app NEVER runs code in the renderer with nodeIntegration. Everything goes through secure IPC.
