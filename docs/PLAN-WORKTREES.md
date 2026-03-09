# Plan: Git Worktrees — Tareas paralelas por proyecto (Premium)

## Objetivo

Permitir que usuarios Premium ejecuten **hasta N tareas SDD simultáneas en el mismo proyecto**, cada una aislada en su propio git worktree con su rama independiente.

**Valor:** Un solo dev con Agent Hub Premium puede hacer lo que normalmente haría un equipo de 3-4 personas — ejecutar múltiples tareas SDD en paralelo sobre el mismo repo.

---

## Arquitectura actual (single task per project)

```
proyecto/                 ← project.path (único directorio)
├── .git/
├── src/
└── feature/1234-...      ← rama creada por git checkout -b
```

- `orchestrator.ts:42` extrae `projectPath = task.project_path`
- Todas las fases pasan `projectPath` como `cwd` a subprocesos
- `queries.ts:120` bloquea si `getRunningTaskCountByProject > 0`
- Toda operación git ocurre en el mismo directorio

## Arquitectura propuesta (worktrees)

```
proyecto/                         ← project.path (repo principal, intocado)
├── .git/
├── src/
└── ...

~/.config/agent-hub/worktrees/
├── {taskId-A}/                   ← worktree para tarea A
│   ├── src/
│   └── feature/0001-login/
├── {taskId-B}/                   ← worktree para tarea B
│   ├── src/
│   └── feature/0002-api/
```

Cada tarea trabaja en su propio worktree. El repo principal queda limpio.

---

## Tareas de implementación

### Tarea 1: Migración DB — campo `worktree_path` en tasks

**Archivo:** `electron/db/migrations.ts`

```sql
-- Migration 015
ALTER TABLE tasks ADD COLUMN worktree_path TEXT DEFAULT NULL;
```

**Criterio de aceptación:**
- Nueva columna `worktree_path` en tabla `tasks`
- NULL = tarea sin worktree (comportamiento legacy)
- Contiene path absoluto al worktree cuando está activo

---

### Tarea 2: Módulo `worktree.ts` — crear/limpiar worktrees

**Archivo nuevo:** `electron/ipc/agent/worktree.ts`

**Funciones:**

```typescript
// Crea un worktree para la tarea
export async function createWorktree(
  projectPath: string,
  taskId: string,
  branchName: string,
  extraEnv?: Record<string, string | undefined>
): Promise<string>  // retorna worktreePath

// Elimina el worktree y limpia refs
export async function removeWorktree(
  projectPath: string,
  worktreePath: string,
  extraEnv?: Record<string, string | undefined>
): Promise<void>

// Lista worktrees activos para un proyecto
export async function listWorktrees(
  projectPath: string
): Promise<{ path: string; branch: string }[]>

// Instala dependencias en el worktree
export async function setupWorktreeDeps(
  worktreePath: string,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow
): Promise<void>
```

**Implementación clave:**

```typescript
async function createWorktree(projectPath, taskId, branchName, extraEnv) {
  const baseDir = path.join(
    app.getPath('userData').replace('agent-hub', ''),
    'agent-hub', 'worktrees'
  );
  await fs.mkdir(baseDir, { recursive: true });

  const worktreePath = path.join(baseDir, taskId);

  // Crear worktree con rama nueva
  await execFileAsync('git', [
    'worktree', 'add', worktreePath, '-b', branchName
  ], projectPath, 30000, false, extraEnv);

  return worktreePath;
}

async function removeWorktree(projectPath, worktreePath, extraEnv) {
  await execFileAsync('git', [
    'worktree', 'remove', worktreePath, '--force'
  ], projectPath, 30000, false, extraEnv);
}
```

**Criterios de aceptación:**
- `createWorktree` crea directorio en `~/.config/agent-hub/worktrees/{taskId}/`
- `removeWorktree` limpia worktree + refs de git
- `setupWorktreeDeps` detecta package manager y ejecuta install
- Maneja errores si el worktree ya existe (re-use)

---

### Tarea 3: Tipos — agregar `worktree_path` a interfaces

**Archivos:**
- `electron/ipc/agent/types.ts` — agregar `worktree_path: string | null` a `TaskRow`
- `src/lib/types.ts` — agregar `worktreePath?: string` a `Task` y `TaskRow`
- `electron/db/queries.ts` — incluir `worktree_path` en queries de task

**Criterio de aceptación:**
- `TaskRow.worktree_path` disponible en backend
- `Task.worktreePath` disponible en frontend
- Query `getTask` retorna el campo

---

### Tarea 4: Licencia — agregar `max_parallel_per_project` a tiers

**Archivo:** `electron/ipc/license.ts`

```typescript
const TIER_LIMITS = {
  free:       { ..., max_parallel_per_project: 1 },
  registered: { ..., max_parallel_per_project: 1 },
  premium:    { ..., max_parallel_per_project: 3 },
};
```

**Archivos adicionales:**
- `src/lib/types.ts` — agregar `max_parallel_per_project` a `LicenseLimits`

**Criterio de aceptación:**
- Free y Registered: 1 tarea por proyecto (comportamiento actual)
- Premium: hasta 3 tareas paralelas por proyecto
- UI muestra el límite

---

### Tarea 5: Concurrencia — modificar bloqueos per-project

**Archivo:** `electron/db/queries.ts` (líneas 120-122)

Cambiar de "bloquear si > 0" a "bloquear si >= max_parallel_per_project":

**Archivo:** `electron/ipc/agent/index.ts` (línea 33)

```typescript
// Antes:
const projectActive = (q.getRunningTaskCountByProject.get(...) as { count: number }).count;
if (projectActive > 0 && task.status === 'queued') {
  throw new Error('Another task is already running...');
}

// Después:
const projectActive = (q.getRunningTaskCountByProject.get(...) as { count: number }).count;
const maxParallel = getLicenseLimits(db).max_parallel_per_project;
if (projectActive >= maxParallel && task.status === 'queued') {
  throw new Error(`Project concurrency limit reached (${maxParallel}).`);
}
```

**Misma lógica en:**
- `orchestrator.ts:172` (resume tras spec feedback)
- `orchestrator.ts:254` (resume tras plan review)
- `pr-feedback.ts:44` (Fetch & Fix)

**Criterio de aceptación:**
- Free/Registered: comportamiento idéntico al actual (1 por proyecto)
- Premium: permite hasta 3 tareas activas en el mismo proyecto
- Mensaje de error muestra el límite correcto

---

### Tarea 6: Orchestrator — integrar worktrees en el flujo

**Archivo:** `electron/ipc/agent/orchestrator.ts`

**Cambio principal en línea 42:**

```typescript
// Después de obtener la task:
const task = q.getTask.get(taskId) as TaskRow;
const projectPath = task.project_path;

// NUEVO: Determinar workDir (worktree o proyecto directo)
let workDir = projectPath;
const maxParallel = getLicenseLimits(db).max_parallel_per_project;

if (maxParallel > 1 && startPhase <= 2) {
  // Crear worktree para esta tarea
  const branchName = await prepareGitBranch(...); // primero crear la rama
  const worktreePath = await createWorktree(projectPath, taskId, branchName, extraEnv);
  q.updateTaskWorktree.run(worktreePath, taskId);
  workDir = worktreePath;

  // Instalar dependencias
  await setupWorktreeDeps(workDir, taskId, projectName, q, getWindow);
} else if (task.worktree_path) {
  // Resuming una tarea que ya tiene worktree
  workDir = task.worktree_path;
}
```

**Reemplazar `projectPath` por `workDir` en todo el flujo:**
- Todas las llamadas a `runClaudePhase(workDir, ...)`
- Todas las llamadas a `runSimplePhase(..., workDir, ...)`
- Git operations: `prepareGitBranch(workDir, ...)`
- `readClaudeMd(workDir)`

**Cleanup en catch y success:**

```typescript
// En el catch (línea 447) y en completion:
if (task.worktree_path) {
  await removeWorktree(projectPath, task.worktree_path, extraEnv).catch(() => {});
  q.updateTaskWorktree.run(null, taskId);
}
```

**Nota importante:** NO limpiar worktree en estados pausados (spec_feedback, plan_review, push_review). Solo limpiar en `completed` y `failed`.

**Criterio de aceptación:**
- Tareas premium con maxParallel > 1 usan worktree
- Tareas free/registered usan directorio original (sin cambios)
- Resume funciona con worktree existente
- Worktree se limpia al completar o fallar
- Worktree persiste en pausas (spec feedback, plan review)

---

### Tarea 7: PR Feedback — usar worktree path

**Archivo:** `electron/ipc/agent/pr-feedback.ts`

**Cambio en línea 33:**

```typescript
const projectPath = task.project_path;
const workDir = task.worktree_path || projectPath;  // ← usar worktree si existe
```

Reemplazar `projectPath` por `workDir` en todas las operaciones git y Claude de este archivo.

**Criterio de aceptación:**
- Fetch & Fix funciona correctamente con worktrees
- Git operations apuntan al worktree
- Claude se ejecuta en el worktree

---

### Tarea 8: Test Runner — worktree-aware

**Archivo:** `electron/ipc/agent/test-runner.ts`

**Cambio en `runTestFixLoop` línea 112:**

```typescript
const projectPath = task.project_path;
const workDir = task.worktree_path || projectPath;
```

Usar `workDir` en vez de `projectPath` para `runNativeTests` y `runClaudePhase`.

**Criterio de aceptación:**
- Tests se ejecutan dentro del worktree
- `npm test` / test command funciona con node_modules del worktree

---

### Tarea 9: UI — indicador de tareas paralelas

**Archivos:**
- `src/components/TasksView.tsx` — badge indicando worktree activo
- `src/components/Dashboard.tsx` — mostrar N tareas activas por proyecto
- `src/components/ProjectsView.tsx` — indicador de slots usados/disponibles

**Diseño UI:**

En la lista de tareas, si una tarea tiene worktree activo:
```
[Task Title]               [In Progress] [Worktree ↗]
feature/0001-login
```

En proyectos, mostrar slots:
```
Mi Proyecto               2/3 tasks running
```

**Criterio de aceptación:**
- Se ve claramente cuántas tareas paralelas hay por proyecto
- Badge "Worktree" visible en tareas con worktree activo
- Indicador de slots en vista de proyectos (solo premium)

---

### Tarea 10: Limpieza de worktrees huérfanos

**Archivo:** `electron/ipc/agent/worktree.ts` (función adicional)

```typescript
export async function cleanOrphanWorktrees(db: Database.Database): Promise<void>
```

**Cuándo ejecutar:**
- Al iniciar la app (`electron/main.ts`)
- Busca directorios en `~/.config/agent-hub/worktrees/` que no tengan tarea activa
- Los elimina con `git worktree remove`

**Criterio de aceptación:**
- Worktrees de tareas completadas/fallidas se limpian al reiniciar
- No se eliminan worktrees de tareas pausadas
- Log informativo de limpieza

---

## Orden de implementación (dependencias)

```
Tarea 1 (DB migration)
    ↓
Tarea 3 (Types)
    ↓
Tarea 2 (worktree.ts module)
    ↓
Tarea 4 (License tiers)  →  Tarea 5 (Concurrency checks)
    ↓                            ↓
Tarea 6 (Orchestrator)  ←───────┘
    ↓
┌───┴───┐
↓       ↓
Tarea 7  Tarea 8    (PR Feedback + Test Runner — paralelas)
    ↓       ↓
    └───┬───┘
        ↓
    Tarea 10 (Cleanup)
        ↓
    Tarea 9 (UI)
```

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| `node_modules` duplicados consumen disco | Alto (puede ser 500MB+ por worktree) | Usar `npm install --prefer-offline` + cache. Documentar que worktrees usan espacio extra. |
| Conflictos de merge entre tareas paralelas | Medio | Es el comportamiento esperado — conflictos se resuelven en el PR, no durante desarrollo. Documentar. |
| Worktrees huérfanos si la app crashea | Medio | Cleanup automático al iniciar (Tarea 10). |
| `npm install` lento en cada worktree | Medio | Ejecutar en background, mostrar progreso. Considerar symlink de node_modules como optimización V2. |
| CLAUDE.md leído del worktree vs proyecto | Bajo | `readClaudeMd(workDir)` funciona porque worktree tiene copia del archivo. |
| Plugins que referencian project.path | Bajo | hookCtx mantiene `projectPath` original + nuevo `workDir`. Plugins que necesiten el repo principal usan `projectPath`. |

## Estimación de esfuerzo

| Tarea | Esfuerzo | Complejidad |
|-------|----------|-------------|
| 1. DB migration | 30 min | Baja |
| 2. worktree.ts | 3 hrs | Media |
| 3. Types | 30 min | Baja |
| 4. License tiers | 30 min | Baja |
| 5. Concurrency | 1 hr | Baja |
| 6. Orchestrator | 3 hrs | Alta |
| 7. PR Feedback | 1 hr | Media |
| 8. Test Runner | 30 min | Baja |
| 9. UI | 2 hrs | Media |
| 10. Cleanup | 1 hr | Media |
| **Testing + edge cases** | **3 hrs** | **Alta** |
| **Total** | **~16 hrs (2 días)** | |

## Alcance V1 vs V2

### V1 (esta implementación)
- Worktrees para premium (max 3 por proyecto)
- Creación/limpieza automática
- UI básica con badges

### V2 (futuro)
- Detección de conflictos potenciales antes de iniciar (análisis de archivos)
- Symlink de node_modules para ahorrar disco
- Merge automático entre worktrees
- Configuración de max_parallel_per_project por el usuario
- Dashboard visual de worktrees con estado de cada rama
