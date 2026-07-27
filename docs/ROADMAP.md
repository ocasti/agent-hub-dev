# Agent Hub — Auditoría y plan de crecimiento

Fecha: 2026-07-27 · Versión auditada: 2.5.0

Documento vivo. Reúne el diagnóstico de una auditoría de cinco frentes (capa de
agentes, máquina de estados, sistema de plugins, metodología de bucles y ahorro de
tokens, y especificaciones reales de los CLIs) y lo convierte en un plan priorizado.

Cada hallazgo cita `archivo:línea`. Lo que no pudo verificarse está marcado como tal.

---

## 0. Resumen ejecutivo

Tres conclusiones que condicionan todo lo demás:

1. **El mercado absorbió los diferenciadores actuales.** Ejecución paralela,
   aislamiento por worktrees y soporte multi-agente son hoy funciones de base en
   Claude Code Desktop, JetBrains Air, Nimbalyst y Claude Squad. El SDD tampoco es
   nicho: Spec Kit va por 120k estrellas y todas las herramientas grandes tienen su
   variante. **Lo defendible es la capa de proceso de equipo**: el ciclo cerrado
   requisito → tarea → código → revisión → aprendizaje.

2. **La promesa del producto excede al código en varios frentes.** Se anuncian 12
   agentes y hay 2. Se documenta un sistema de plugins con fases, enriquecimiento y
   webhooks: las tres son código muerto o inexistentes. Se promete cifrado de
   secretos y aprendizaje medible: ninguno existe. Esto no es deuda técnica, es
   deuda de credibilidad — el primer usuario que siga la guía de plugins se lleva
   una herramienta rota.

3. **La causa de "Gemini no se detecta transparente" está identificada y es de una
   línea.** Ver §1.1.

---

## 1. Problemas concretos reportados por usuarios

### 1.1 Gemini CLI — causa raíz encontrada

**Diagnóstico.** Gemini CLI trae `security.folderTrust.enabled = true` por defecto.
En modo headless no puede mostrar el diálogo de confianza, así que lanza
`FatalUntrustedWorkspaceError` y **sale con código 55 y stdout vacío** en cualquier
directorio que el usuario no haya abierto antes de forma interactiva. Reproducido en
vivo sobre la versión 0.52.0.

El adaptador no contempla ese código: `generic-adapter.ts:252` declara
`fatalExitCodes: [41, 42, 44, 52]`. El 55 cae al heurístico de marcadores, no
encuentra ninguno (stdout está vacío) y se reporta como fallo genérico
`Agent phase exited with code 55`, sin ninguna pista de qué hacer.

**Arreglo.** Pasar `--skip-trust` (y `GEMINI_CLI_TRUST_WORKSPACE=true` como cinturón
y tirantes) en `buildRunArgs`.

**Otros defectos del mismo adaptador**, todos en `generic-adapter.ts:239-256`:

| Defecto | Detalle |
|---|---|
| `-p ''` vacío | `buildRunArgs: () => ['-p', '', '-y']` pasa un prompt vacío como argumento. Si una versión lo valida, sale 42 (`FatalInputError`), que sí es fatal, sin indicar que el argumento vacío es nuestro |
| `-y` obsoleto | Está deprecado en favor de `--approval-mode yolo`. Además **`-y` y `--approval-mode` juntos son error duro** de parseo: hay que elegir uno |
| Modelo ignorado | `buildRunArgs` recibe `model` y lo descarta. Gemini acepta `-m` con `auto\|pro\|flash\|flash-lite` o nombres completos |
| Códigos incompletos | Faltan 54 (`FatalToolExecutionError`), 55 (untrusted) y 130 (SIGINT). La documentación oficial de headless solo lista 0/1/42/53; la tabla completa está en el código fuente del CLI |
| Cuota como exit 1 | Los errores de cuota salen con 1, indistinguibles de cualquier otro fallo. Solo se separan parseando `.error.message` de `--output-format json`. El tier gratuito de API key es **solo Flash**: pedir `pro` falla |
| stderr ruidoso | Emite avisos en stderr incluso con éxito (`Ripgrep is not available…`). No debe tratarse como fallo |

**Falso negativo permanente del SDD Kit.** `checkSpeckitForAgent`
(`agents/registry.ts:45-53`) busca solo en `~/.gemini/commands/`, pero el mensaje que
la app le muestra al usuario es `specify init . --ai gemini`
(`orchestrator.ts:91-95`), que escribe en el **directorio del proyecto**. Seguir la
instrucción nunca apaga el aviso. Hay que sondear ambas rutas.

**Detección sin diagnóstico.** `checkInstalled` devuelve `string | null` y hace
`catch { return null }` (`generic-adapter.ts:56-63`), colapsando en un mismo "no
instalado" cuatro causas distintas: binario ausente, timeout de 10 s, salida no cero
y stdout vacío. El usuario ve un punto gris sin explicación.

### 1.2 opencode — integración nueva

Verificado en vivo sobre la versión 1.17.8. **El repositorio cambió de dueño**:
`sst/opencode` ahora redirige a `anomalyco/opencode`; el tap de Homebrew es
`anomalyco/tap/opencode`.

Configuración del adaptador:

```
binary:        opencode                    (Mach-O nativo, no shim de node)
versionArgs:   ["--version"]               stdout = "1.17.8\n" exacto, stderr vacío
runArgs:       ["run", "--dangerously-skip-permissions", "-m", "{model}", "{prompt}"]
promptVia:     argumento posicional
modelo:        formato provider/model, puede tener más de una barra
authCheck:     ["auth","list"] → parsear "N credentials"; el exit code NO sirve
exitCodes:     solo 0 y 1, sin semántica
```

**Tres trampas que hay que respetar:**

- **stdin bloquea indefinidamente.** opencode lee stdin siempre que no sea un TTY,
  lo cual es siempre cierto en un subproceso de Electron. Si se le pasa un stdin
  abierto que nunca recibe EOF, **se cuelga** (reproducido, más de 2 minutos). Hay
  que pasar el prompt como argumento y cerrar stdin o ponerlo en `ignore`.
- **`-p` NO es prompt**, es `--password`. Pasar el prompt con `-p` lo interpreta como
  contraseña de autenticación básica, en silencio.
- **`--format default` deja stdout limpio** (solo el texto del agente; el banner va a
  stderr), que es exactamente lo que necesita el parseo de marcadores. `--format
  json` es JSONL, un evento por línea, no un objeto único.

Además: el instalador por curl deja el binario en `~/.opencode/bin`, que **no está en
el PATH de una app de Electron lanzada desde el Finder** — hay que añadirlo al arreglo
de PATH de `main.ts`. Y en macOS emite `error: Error starting FSEvents stream` en
stderr en cada ejecución con exit 0: no es un fallo.

`--auto` y `--yolo` existen en 1.18 pero **son rechazados en 1.17.8**; solo
`--dangerously-skip-permissions` funciona en ambas.

### 1.3 Puntos muertos y bucles de aprobación

Se mapeó la máquina de estados completa. Tres regresiones introducidas por el pase de
hardening **ya están corregidas** (commit `2035460`):

- `fixing` no estaba en ninguna lista de la taxonomía → una caída durante el fix de
  la fase 3 consumía un slot de concurrencia para siempre; en el tier gratuito
  (`max_concurrent = 1`) eso bloqueaba la app entera.
- Cuatro rutas de fallo no liberaban `activeControllers`; con la nueva guarda de
  re-entrada, eso dejaba la tarea imposible de reintentar.
- El arranque reconciliaba antes de limpiar worktrees, destruyendo el trabajo sin
  commitear de las tareas que acababa de reencolar.

**Lo que sigue abierto**, por orden de gravedad:

| Id | Problema | Evidencia |
|---|---|---|
| D4 | Fetch & Fix interrumpido degrada la tarea a re-ejecución completa: `pr_fixing` se reencola con `last_phase = -1`, así que una tarea ya shipeada vuelve a la fase 0 | `orchestrator.ts:569` pone `last_phase = -1` antes de `pr_feedback`; `runFetchAndFix` nunca lo toca |
| D6 | En `push_review` tras reiniciar la app, "Request Revision" es un botón muerto: el fallback sin resolver solo contempla `reject` y `approve`; `revise` no hace nada y la UI reporta éxito | `agent/index.ts:210-237` |
| D8 | `test_fixing` no tiene salida: si los tests no se arreglan solos, la única vía es Editar (re-encolar la tarea entera). Con `test_fix_retries` en 0 o negativo, cada clic vuelve al mismo estado sin ejecutar nada | `pr-feedback.ts:585-640`, `state.ts:134-141` |
| D9 | `review_cycle` se comparte entre el quality gate y el ciclo de PR. Una tarea con `review_cycle ≥ max_review_loops` **salta la fase 3 entera** y va directa a Ship, y aun así dispara `on:quality_pass` | `orchestrator.ts:417-420`, `:493` |
| D10 | Un arranque rechazado (límite de concurrencia) deja un agente fantasma: la UI inserta la entrada antes de la llamada y solo revierte si lanza excepción, pero los rechazos retornan normalmente | `App.tsx:426-441`, `agent/index.ts:57,65,80` |
| — | **No existe ninguna acción de "forzar reset"**. Todo estado atascado se escapa por Editar, que re-encola desde cero y cierra el PR | inventario completo de handlers IPC |
| — | El estado de pausa vive **solo en memoria** (`specResolvers`, `planResolvers`, `pushResolvers`, `fixTestsResolvers`). Al reiniciar, los veredictos por hilo del ciclo de PR se pierden | `state.ts:10-13`, `pr-feedback.ts:322-323` |

---

## 2. Estrategia de producto

### 2.1 Dónde está el producto frente al mercado

| Capacidad | Estado del mercado 2026 | Implicación |
|---|---|---|
| Ejecución paralela de agentes | De serie en Claude Code Desktop, Nimbalyst, JetBrains Air | Ya no diferencia |
| Aislamiento por git worktree | De serie en Nimbalyst | Ya no diferencia |
| Multi-agente (varios CLIs) | JetBrains Air, Claude Squad | Ya no diferencia |
| Metodología SDD | Spec Kit 120k ★, OpenSpec 52k ★, todas las suites grandes | Commodity |
| **Ciclo de feedback de PR (Fetch & Fix)** | Poco común | **Defendible** |
| **Integración PM ↔ código ↔ revisión** | Poco común | **Defendible** |
| **Aprendizaje que retroalimenta prompts** | Raro (y aquí está sin cerrar) | **Defendible si se completa** |

**Tesis recomendada:** dejar de competir en "ejecutar agentes" y posicionarse en
**"el bucle de calidad de un equipo"** — desde el requisito hasta el PR aprobado, con
memoria entre tareas. Eso encaja exactamente con la metodología de bucles.

### 2.2 Loop engineering

Metodología nombrada por **Addy Osmani el 7 de junio de 2026**
(<https://addyosmani.com/blog/loop-engineering/>, republicada en O'Reilly Radar el
22 de junio). Definición del autor: *"loop engineering es reemplazarte a ti como la
persona que prompta al agente; diseñas el sistema que lo hace en tu lugar."*

> Nota: la guía de Augment Code afirma que se acuñó en 2024. Contradice la fecha del
> ensayo original; tratar ese dato como erróneo.

Se sitúa en una pila de cuatro capas: prompt engineering (cómo se formula) → context
engineering (qué ve el modelo) → harness engineering (cómo se ejecuta el código
alrededor) → **loop engineering (quién promptea y cuándo se detiene)**.

Componentes según Osmani, contrastados con lo que ya existe aquí:

| Componente | Estado en Agent Hub |
|---|---|
| Worktrees | ✅ implementado |
| Skills (conocimiento durable) | ✅ implementado |
| Plugins / conectores MCP | ⚠️ parcial (ver §3) |
| Estado externo entre sesiones | ✅ SQLite |
| Sub-agentes con separación maker/checker | ❌ **falta** |
| Automatizaciones programadas | ❌ **falta** |

**Patrones concretos a adoptar:**

- **Verificación en orden de coste creciente.** Primero lo determinista y gratis
  (typecheck, lint), luego tests, y solo entonces la revisión por IA. Hoy la fase 3
  ya hace "tests → revisión IA → fix", pero **no hay escalón de typecheck/lint
  previo**: se gastan tokens revisando código que ni compila.
- **Salidas legibles por máquina.** El bucle termina por la salida de un verificador
  (código de salida, JSON), nunca porque el agente diga que terminó. Hoy el veredicto
  es un marcador de texto en el transcript — frágil por diseño.
- **Dos topes independientes:** máximo de iteraciones **y** máximo de gasto. Existe el
  primero (`on:quality_max_loops`); **no existe tope de presupuesto**.
- **Separación maker/checker.** Quien revisa no debe ser quien escribió. La
  resolución por fase del tier Premium ya permite esto: basta una política de
  "el agente de la fase 3 debe ser distinto al de la fase 2".
- **Autonomía progresiva L1 → L2 → L3.** L1 solo reporta, L2 abre PR y un humano
  mergea, L3 desatendido. Ningún bucle debería nacer en L3.

Osmani advierte tres cosas que conviene codificar como restricciones de producto: la
carga de verificación sigue siendo humana, la deuda de comprensión crece más rápido
que el código, y *"la postura cómoda es la peligrosa"*.

Implementación de referencia con siete patrones de bucle listos (Daily Triage, PR
Babysitter, CI Sweeper, Dependency Sweeper…): <https://github.com/cobusgreyling/loop-engineering>

### 2.3 Ahorro de tokens — conclusión contraintuitiva

**`rtk.ia` es `rtk-ai/rtk`** (73k ★, Rust, Apache-2.0). Comprime la salida de los
comandos que ejecuta el agente antes de que entre al contexto, vía hooks `PreToolUse`,
con integraciones para ~15 agentes. Opera exactamente en la capa donde vive Agent Hub.

**No lo adoptes por defecto.** JetBrains publicó un A/B controlado (86 tareas, 425
ejecuciones facturadas, Claude Sonnet 5) el 2026-07-20:

- Con esfuerzo bajo: **+7,6 % más caro** (p = 0,004, significativo)
- Con esfuerzo alto: **±0 %**, sin diferencia medible
- Calidad sin cambios en ambos casos

Mientras tanto, el propio `rtk gain` reportaba 96,2 millones de tokens ahorrados en
esas mismas ejecuciones donde la factura subió. Las razones: el hook solo toca ~20 %
de los caracteres de resultados de herramientas, Claude Code ya trunca salidas
patológicas, y la mayor parte del coste de entrada son relecturas cacheadas facturadas
al ~10 % — comprimirlas no ahorra casi nada y **cambiarlas rompe el prefijo de caché**.

La lección de JetBrains vale como principio: *el ahorro que una herramienta se
autoreporta es una afirmación sobre su contrafactual, no sobre tu factura.*

Lo mismo aplica a `caveman` (93k ★): 65 % anunciado, **8,5 % medido**.

**Además, la mayoría del instrumental clásico no aplica aquí**, y conviene decirlo sin
rodeos: Agent Hub **no llama a ninguna API de LLM**. Lanza CLIs que gestionan su
propio contexto y su propia caché. Eso descarta LLMLingua (solo Python, y requiere
controlar la ruta prompt→API), GPTCache (cachea respuestas de API que aquí no
existen, y lleva ~1 año sin mantenimiento) y en general cualquier librería de
compresión de prompts.

**Lo que sí funciona** son los mecanismos del propio CLI:

| Palanca | Detalle |
|---|---|
| `--max-budget-usd` | Tope de gasto duro, solo en modo print. **Es el tope de presupuesto que la metodología de bucles exige y hoy no existe** |
| `--max-turns N` | Corta bucles desbocados |
| `--output-format json` | Trae `usage` y `total_cost_usd`. **Sin esto no hay medición posible** |
| `--effort` | Palanca más barata que cambiar de modelo para trabajo rutinario |
| `--exclude-dynamic-system-prompt-sections` | Mitiga el problema de caché de los worktrees (ver abajo) |
| Hooks `PreToolUse` propios | La documentación de Anthropic da el ejemplo: un hook que filtra la salida de tests "reduce el contexto de decenas de miles de tokens a cientos". **Diez líneas por proyecto, sin dependencias** |

**Dos hallazgos de caché que golpean la arquitectura actual:**

1. **Cada worktree tiene su propia caché.** La documentación es explícita: el system
   prompt embebe el directorio de trabajo, y *"eso incluye worktrees del mismo
   repositorio"*. Agent Hub crea un worktree por tarea, así que **toda tarea arranca
   con caché fría**. Mitigable con `--exclude-dynamic-system-prompt-sections`.
2. **Cambiar de modelo entre fases destruye la caché**: cada modelo tiene la suya, y
   también está indexada por nivel de esfuerzo. Esto tensiona directamente con el tier
   Premium (modelo por fase): solo es palanca de ahorro si cada fase es una sesión
   nueva. Mezclar sesión compartida y cambio de modelo es el peor caso. **Hay que
   elegir una estrategia por proyecto y documentarla.**

Gemini CLI no tiene equivalentes de `--max-budget-usd` ni `--max-turns` — para
agentes no-Claude el tope hay que imponerlo externamente (timeout de reloj más
contabilidad propia). Es un hueco real de la abstracción multi-agente.

---

## 3. Sistema de plugins — la brecha entre promesa y código

Lo que un tercero puede construir hoy es: **un hook que llama a un servidor MCP por
HTTP/SSE, y un campo en el formulario de tareas.** Nada más.

| Punto de extensión | Estado |
|---|---|
| Hooks (25 eventos) | ✅ funciona: dispatch, prioridad, bloqueo, aislamiento de errores |
| Fases desde manifiesto | ❌ **código muerto** — `resolveWorkflowPhases` (`engine.ts:270`) no tiene ni un llamador. Las fases 4 y 5 están hardcodeadas; la lista del frontend es un array estático (`src/lib/workflow.ts:3-23`) |
| Enriquecimiento | ❌ **código muerto** — `getEnrichmentData` (`engine.ts:182`) sin llamadores; el parámetro `enrichment` de `buildPhasePrompt` recibe `undefined` en los cuatro sitios |
| Acciones tipo webhook | ❌ **no existen** — documentadas en la guía, cero implementación |
| MCP por stdio | ❌ **rechazado** (`mcp-client.ts:70-72`). Es decir, prácticamente todo el ecosistema `npx`/`uvx` (Linear, Notion, Sentry…) es inutilizable |
| Adaptadores de nivel 2 | ❌ imposible para terceros: el mapa de factorías es de tiempo de compilación (`adapters/registry.ts:16-19`); `registerAdapterFactory` está exportado y nunca se llama |
| Agentes nuevos | ❌ imposible: `BUILTIN_AGENTS` es un array de TypeScript con un campo función, no serializable |
| taskFields | ⚠️ parcial: `after:*` y `form.end` declarados y nunca renderizados |
| Toggle enabled/disabled | ⚠️ el campo se lee, pero **no hay handler IPC ni UI para cambiarlo** |

**Los plugins que se envían están rotos.** Los manifiestos de GitHub y Bitbucket
declaran operaciones con `"tool": "cli_exec", "server": "local"`, que no existen — su
único hook falla siempre. Funcionan solo porque la lógica real vive en los
adaptadores compilados; los manifiestos son decorativos.

**Jira no funciona de cuatro formas independientes:** el manifiesto espera
`{statusName}` y el motor inyecta `statusId` (ninguna transición se dispara nunca);
`on:quality_fail` usa variables que el motor no provee; su servidor MCP es stdio
(rechazado); y su bloque de credenciales usa una sintaxis de plantilla distinta a la
del resolvedor, con claves que ni siquiera están en su propio `configSchema`.

**La guía de 1626 líneas está mal en al menos seis puntos estructurales** (forma de
`configSchema`, de `setup.json`, de `installed.json`, acciones webhook, cifrado de
secretos, compilación de TypeScript). Un desarrollador que la siga produce un plugin
que no arranca. Es peor que no tener guía.

---

## 4. Observabilidad — lo que el usuario no puede ver

| Pregunta | Respuesta hoy |
|---|---|
| ¿Por qué falló esta tarea? | Nada. No hay columna de error ni banner; solo una insignia roja |
| ¿Qué imprimió el agente? | Solo si está en las últimas 100 líneas globales: `logs:getAll` **no acepta `taskId`** |
| ¿Cuánto tardó? | Nunca se mide |
| ¿Cuánto costó / cuántos tokens? | **Cero instrumentación.** El adaptador pide texto plano, así que el dato ni se genera |
| ¿Qué cambió? | Solo recuentos, solo desde el Dashboard, y el worktree se borra al terminar |
| Historial de ejecuciones | No existe |

**`agent_runs` es una tabla de solo escritura.** Se insertan filas con el transcript
completo y nunca se leen: `getAgentRunsByTask` no tiene llamadores, no hay puente IPC
ni UI. Peor: ambos adaptadores guardan la fase como el literal `'phase'`, aunque
`runAgentPhase` conoce el número real. La app acumula cada transcript para siempre,
sin atribuir y sin poder mostrarlo.

Otros: la barra de progreso es ficción (se queda en 40 % durante toda la fase de
implementación); los fallos de las fases 0, 3 y 4 **no disparan notificación** porque
retornan en vez de lanzar; `logs` no tiene índices (cero `CREATE INDEX` en 19
migraciones) ni retención, y se consulta con `ORDER BY created_at` cada 3 segundos.

---

## 5. Plan por fases

### Fase A — Desatascar (1-2 semanas)

Objetivo: que lo que ya existe funcione y sea diagnosticable.

1. **Arreglar Gemini.** `--skip-trust` + `GEMINI_CLI_TRUST_WORKSPACE=true`; quitar el
   `-p ''` vacío; `--approval-mode yolo` en vez de `-y`; pasar `-m`; completar
   `fatalExitCodes` con 54, 55 y 130 y dar mensajes accionables por código (41 → "no
   autenticado, ejecuta…"). Sondear el SDD Kit también en el directorio del proyecto.
2. **Detección con diagnóstico.** Cambiar `checkInstalled` para devolver
   `{ installed, version, errorKind, resolvedPath, stderr }`, cachear el resultado por
   sesión, y añadir un botón "Probar agente" que muestre el comando y su salida cruda.
   Añadir comprobación de autenticación por agente (para Gemini, exit 41; para
   opencode, parsear `auth list`).
3. **Añadir opencode**, respetando las tres trampas (stdin cerrado, prompt como
   argumento, `--dangerously-skip-permissions`) y añadiendo `~/.opencode/bin` al PATH.
4. **Cerrar los puntos muertos restantes**: rama `revise` en el fallback de
   `continuePush` (D6); persistir `last_phase = 5` al entrar en `pr_fixing` (D4);
   salida de emergencia en `test_fixing` (D8); separar el contador de ciclo de revisión
   del de PR (D9); revertir el agente fantasma en todos los rechazos (D10).
5. **Acción "forzar reset"** para cualquier estado sin salida, sin cerrar el PR.
6. **Diagnóstico de fallos**: columna `error` y `failed_phase` en `tasks`, banner en
   `TaskDetail`, y `taskId` como parámetro de `logs:getAll`.

### Fase B — Medir antes de optimizar (2-3 semanas)

Nada de lo que sigue tiene sentido sin datos.

7. **`--output-format json` y persistir `usage` y `total_cost_usd` por fase** en
   `agent_runs`, con la fase real en vez del literal `'phase'`.
8. **Exponer `agent_runs`** como historial con duraciones y coste. El dato ya se
   escribe; falta canal IPC y una línea de tiempo en `TaskDetail`. Es el ítem con más
   valor por línea de código del repo.
9. **Índices y retención en `logs`** (`logs(task_id, created_at)`), tope de filas.
10. **Reintentar desde una fase elegida.** El parámetro `startPhase` ya está cableado
    de punta a punta; los tres botones llaman a `runAgent(task.id)` sin argumento.

### Fase C — El bucle como producto (4-6 semanas)

Aquí es donde el producto deja de ser un lanzador de agentes.

11. **Escalón de verificación determinista** (typecheck + lint) antes de la revisión
    por IA en la fase 3. Coste cero, ahorro inmediato.
12. **Topes de presupuesto e iteración por tarea**: `--max-budget-usd` y `--max-turns`
    en Claude; equivalente externo para los demás agentes.
13. **Niveles de autonomía L1/L2/L3** por proyecto, con L3 detrás de historial.
14. **Separación maker/checker**: política de "el agente revisor ≠ el implementador",
    reutilizando la resolución por fase que ya existe.
15. **Automatizaciones programadas** (CI Sweeper, PR Babysitter): el componente que
    falta de la metodología, y encaja natural con los adaptadores existentes.
16. **Hooks `PreToolUse` por proyecto** generados a partir del `test_command` conocido,
    para filtrar salidas verbosas. Esta es la alternativa recomendada a rtk.
17. **Resolver la tensión modelo-por-fase vs caché** y documentarla como elección
    explícita por proyecto.

### Fase D — Ecosistema (continuo)

18. **Cablear o borrar el código muerto de plugins**: fases desde manifiesto,
    enriquecimiento, y una acción `http`/`webhook` genérica. Esto solo desbloquea
    notificaciones, CI/CD y reporters de tests a la vez.
19. **Soportar MCP por stdio**, sin lo cual el ecosistema real es inalcanzable.
20. **Arreglar o retirar el plugin de Jira**, y **reescribir la guía contra el código
    real**. Mientras la guía mienta, cada early adopter se quema una sola vez.
21. **Cerrar el bucle de aprendizaje**: deduplicar al insertar, cablear
    `incrementKnowledgeApplied` (hoy sin llamadores, así que `times_applied` es
    siempre 0), poblar `review_patterns` (idem), recuperar por relevancia en vez de por
    severidad global, y mostrar una métrica de efectividad. Hasta entonces, "aprende de
    las revisiones" no está respaldado por la propia UI.
22. **Secretos cifrados** con `safeStorage`, y quitar la promesa de cifrado de los
    documentos hasta que sea cierta.

### No hacer

- **No adoptar rtk por defecto** (+7,6 % medido con esfuerzo bajo). Como mucho, un
  toggle opcional por proyecto y midiendo antes y después.
- **No adoptar caveman** (8,5 % medido frente a 65 % anunciado, y el skill añade
  ~1-1,5k tokens de entrada por turno).
- **No adoptar LLMLingua ni GPTCache**: arquitectónicamente inaplicables aquí.
- **No competir en paralelismo ni en aislamiento de worktrees**: ese terreno ya lo
  ocupa el proveedor de la plataforma.

---

## 6. Métricas para saber si el plan funciona

Ninguna existe hoy; todas dependen de la fase B.

| Métrica | Por qué |
|---|---|
| Tasa de tareas completadas sin intervención | Mide si el bucle realmente cierra |
| Coste medio por tarea completada | Justifica el tier Premium y habilita precio por uso |
| Ciclos de revisión hasta aprobar | Mide si el aprendizaje sirve |
| Tareas atascadas por semana | Mide la resiliencia |
| Agentes detectados correctamente en el primer intento | Mide el onboarding |

---

## Fuentes externas

- [Loop Engineering — Addy Osmani](https://addyosmani.com/blog/loop-engineering/) · [O'Reilly Radar](https://www.oreilly.com/radar/loop-engineering/) · [patrones de referencia](https://github.com/cobusgreyling/loop-engineering)
- [rtk-ai/rtk](https://github.com/rtk-ai/rtk) · [benchmark de JetBrains](https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/) · [benchmark de caveman](https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/)
- [Claude Code — costes](https://code.claude.com/docs/en/costs) · [caché de prompts](https://code.claude.com/docs/en/prompt-caching) · [referencia CLI](https://code.claude.com/docs/en/cli-reference)
- [Gemini CLI — headless](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md) · [carpetas de confianza](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/trusted-folders.md) · [códigos de salida](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/errors.ts)
- [opencode — docs](https://opencode.ai/docs/cli/) · [repositorio (anomalyco)](https://github.com/anomalyco/opencode)
- Panorama competitivo: [apps multi-agente 2026](https://nimbalyst.com/blog/best-multi-agent-desktop-apps-claude-code-codex-2026/) · [rediseño de Claude Code Desktop](https://miraflow.ai/blog/claude-code-desktop-redesign-parallel-sessions-routines-workspace-guide) · [estado del SDD](https://thebcms.com/blog/spec-driven-development)
