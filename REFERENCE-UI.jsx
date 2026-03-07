import { useState, useReducer, useEffect, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// SKILLS REGISTRY — Aligned with project CLAUDE.md
// ═══════════════════════════════════════════════════════════════

const CORE_SKILLS = [
  // --- Engineering Principles (technology-agnostic) ---
  { id: "ramziddin/solid", name: "SOLID Principles", author: "ramziddin", repo: "ramziddin/solid-skills", category: "Engineering", desc: "SRP, Open/Closed, Liskov, Interface Segregation, Dependency Inversion", locked: true },
  { id: "ramziddin/tdd", name: "TDD", author: "ramziddin", repo: "ramziddin/solid-skills", category: "Engineering", desc: "Red → Green → Refactor. Tests first, always", locked: true },
  { id: "ramziddin/clean-code", name: "Clean Code", author: "ramziddin", repo: "ramziddin/solid-skills", category: "Engineering", desc: "Short methods, descriptive names, no code smells, no dead code", locked: true },
  { id: "ramziddin/architecture", name: "Clean Architecture", author: "ramziddin", repo: "ramziddin/solid-skills", category: "Engineering", desc: "Layers, dependency inversion, value objects, design patterns", locked: true },
  // --- Quality & Compliance ---
  { id: "ia-reviewer", name: "IA Reviewer", author: "Custom", repo: "local (.claude/skills/)", category: "Quality Gate", desc: "Pre-push reviewer that replicates CI. Review by severity: Critical → High → Medium → Low. Loop until 'Ready to merge'", locked: true },
  { id: "tob/spec-compliance", name: "Spec-to-Code Compliance", author: "Trail of Bits", repo: "trailofbits/spec-to-code-compliance", category: "Compliance", desc: "Verifies implementation matches the spec. Automated audit", locked: true },
  // --- Workflow ---
  { id: "callstack/github", name: "Git & GitHub Workflow", author: "Callstack", repo: "callstackincubator/github", category: "Workflow", desc: "Conventional commits, branching, PRs, code review patterns", locked: true },
  { id: "alinaqi/sdd", name: "Spec-Driven Development", author: "alinaqi", repo: "alinaqi/claude-bootstrap", category: "Workflow", desc: "Spec-driven atomic todos, CLI orchestration", locked: true },
];

const OPTIONAL_SKILLS = [
  // --- Platforms & Languages ---
  { id: "wordpress-pro", name: "WordPress Pro", author: "Jeffallan", repo: "local (.claude/skills/)", install: "Included locally", category: "Platform", desc: "WPCS, security (nonces, sanitization, escaping), hooks/filters, Gutenberg, WooCommerce, REST API, PHP 8.1+", tags: ["wordpress", "php", "woocommerce"] },
  { id: "react-patterns", name: "React Best Practices", author: "community", repo: "community", install: "npx skills add react-best-practices", category: "Platform", desc: "Hooks, Server Components, Next.js, state management, testing patterns", tags: ["react", "nextjs", "typescript"] },
  { id: "vue-skills", name: "Vue 3 Skills", author: "community", repo: "vue-skills", install: "npx skills add vue-skills", category: "Platform", desc: "Composition API, Pinia, Nuxt 3, TypeScript integration", tags: ["vue", "nuxt", "typescript"] },
  { id: "nestjs-patterns", name: "NestJS Patterns", author: "community", repo: "community", install: "npx skills add nestjs-patterns", category: "Platform", desc: "Modules, guards, interceptors, DTOs, microservices", tags: ["nestjs", "typescript", "api"] },
  { id: "fastapi-patterns", name: "FastAPI Patterns", author: "community", repo: "community", install: "npx skills add fastapi-patterns", category: "Platform", desc: "Pydantic, async, dependency injection, SQLAlchemy", tags: ["python", "fastapi", "api"] },
  { id: "flutter-skills", name: "Flutter / Dart", author: "community", repo: "community", install: "npx skills add flutter-skills", category: "Platform", desc: "Widgets, state management, platform channels, testing", tags: ["flutter", "dart", "mobile"] },
  { id: "avdlee/swiftui", name: "SwiftUI Expert", author: "AvdLee", repo: "AvdLee/swiftui-expert-skill", install: "npx skills add AvdLee/swiftui-expert-skill", category: "Platform", desc: "Modern SwiftUI, iOS 26+ Liquid Glass", tags: ["swift", "ios", "swiftui"] },
  { id: "expo/app-design", name: "Expo / React Native", author: "Expo", repo: "expo/expo-app-design", install: "npx skills add expo/expo-app-design", category: "Platform", desc: "Expo apps, React Native, deployment", tags: ["react-native", "expo", "mobile"] },
  // --- Frameworks & Tools ---
  { id: "obra/superpowers", name: "Superpowers (20+ skills)", author: "obra", repo: "obra/superpowers", install: "/plugin marketplace add obra/superpowers-marketplace", category: "Framework", desc: "Brainstorming, planning, git worktrees, TDD enforcement, subagent dev", tags: ["planning", "worktrees"] },
  { id: "tob/static-analysis", name: "Static Analysis", author: "Trail of Bits", repo: "trailofbits/static-analysis", install: "npx skills add trailofbits/static-analysis", category: "Security", desc: "CodeQL, Semgrep, SARIF for static analysis", tags: ["security", "sast"] },
  { id: "tob/testing-handbook", name: "Testing Handbook", author: "Trail of Bits", repo: "trailofbits/testing-handbook-skills", install: "npx skills add trailofbits/testing-handbook-skills", category: "Testing", desc: "Fuzzers, sanitizers, advanced test patterns", tags: ["testing"] },
  { id: "alirezarezvani/architecture", name: "Architecture + ADR", author: "alirezarezvani", repo: "alirezarezvani/claude-skills", install: "git clone alirezarezvani/claude-skills", category: "Architecture", desc: "System architecture, ADR templates", tags: ["architecture", "adr"] },
  { id: "alirezarezvani/review", name: "Code Review Agent", author: "alirezarezvani", repo: "alirezarezvani/claude-skills", install: "git clone alirezarezvani/claude-skills", category: "Quality", desc: "Code review with quality scoring and PR analysis", tags: ["review"] },
  { id: "composio/changelog", name: "Changelog Generator", author: "Composio", repo: "ComposioHQ/changelog-generator", install: "npx skills add ComposioHQ/changelog-generator", category: "Workflow", desc: "Git commits → release notes", tags: ["changelog"] },
  { id: "ehmo/design-skills", name: "Design Rules (300+)", author: "ehmo", repo: "ehmo/platform-design-skills", install: "npx skills add ehmo/platform-design-skills", category: "Design", desc: "Apple HIG, Material Design 3, WCAG 2.2", tags: ["ui", "accessibility"] },
  { id: "massimo/recursive", name: "Recursive Decomposition", author: "massimo", repo: "massimodeluisa/recursive-decomposition-skill", install: "npx skills add massimodeluisa/recursive-decomposition-skill", category: "Workflow", desc: "Large tasks (100+ files, 50k+ tokens)", tags: ["large-projects"] },
  { id: "tob/ask-questions", name: "Ask if Underspecified", author: "Trail of Bits", repo: "trailofbits/ask-questions-if-underspecified", install: "npx skills add trailofbits/ask-questions-if-underspecified", category: "Workflow", desc: "Asks for clarification on ambiguous requirements", tags: ["requirements"] },
  { id: "stripe/best-practices", name: "Stripe Best Practices", author: "Stripe", repo: "stripe/stripe-best-practices", install: "npx skills add stripe/stripe-best-practices", category: "Payments", desc: "Webhooks, checkout, subscriptions", tags: ["payments"] },
  { id: "fvadicamo/git", name: "Advanced Git", author: "fvadicamo", repo: "fvadicamo/dev-agent-skills", install: "npx skills add fvadicamo/dev-agent-skills", category: "Workflow", desc: "Advanced Git skills: commits, PRs, reviews", tags: ["git"] },
];

const ALL_SKILLS = [...CORE_SKILLS, ...OPTIONAL_SKILLS];
const findSkill = (id, customSkills = []) => ALL_SKILLS.find(s => s.id === id) || customSkills.find(s => s.id === id) || { id, name: id, category: "Custom", desc: "" };

// ═══════════════════════════════════════════════════════════════
// PHASES — Aligned with CLAUDE.md mandatory workflow
// ═══════════════════════════════════════════════════════════════

const WORKFLOW_PHASES = [
  { id: "spec_analyze", label: "Spec Review: Analyzing", phase: 0, skill: "spec-compliance", icon: "🔎" },
  { id: "spec_validate", label: "Spec Review: Validating completeness", phase: 0, skill: "spec-compliance", icon: "📐" },
  { id: "spec_ok", label: "Spec Review: Spec OK ✓", phase: 0, skill: "spec-compliance", icon: "✅" },
  { id: "plan_decompose", label: "Plan: Decomposition", phase: 1, skill: "senior-engineering", icon: "📋" },
  { id: "plan_risks", label: "Plan: Risks & deps", phase: 1, skill: "senior-engineering", icon: "⚠️" },
  { id: "plan_approval", label: "Plan: Approval", phase: 1, skill: "senior-engineering", icon: "✓" },
  { id: "impl_code", label: "Implement: Code + Standards", phase: 2, skill: "platform-skill", icon: "⚙️" },
  { id: "impl_tests", label: "Implement: Unit tests", phase: 2, skill: "TDD", icon: "🧪" },
  { id: "gate_phpunit", label: "QA Gate: Tests pass", phase: 3, skill: "ia-reviewer", icon: "✅" },
  { id: "gate_review", label: "QA Gate: IA Review", phase: 3, skill: "ia-reviewer", icon: "🔍" },
  { id: "gate_fix", label: "QA Gate: Fix issues", phase: 3, skill: "ia-reviewer", icon: "🔧" },
  { id: "gate_recheck", label: "QA Gate: Re-check", phase: 3, skill: "ia-reviewer", icon: "🔄" },
  { id: "gate_pass", label: "QA Gate: Ready to merge ✓", phase: 3, skill: "ia-reviewer", icon: "🟢" },
  { id: "commit_push", label: "Commit & Push", phase: 4, skill: "git-workflow", icon: "📤" },
  { id: "ci_review", label: "CI: GitHub Actions review", phase: 4, skill: "claude-sonnet-4-6", icon: "🤖" },
  { id: "pr_waiting", label: "Waiting for human review", phase: 5, skill: "manual", icon: "⏸️" },
  { id: "pr_fetch", label: "gh pr view --comments", phase: 5, skill: "git-workflow", icon: "📥" },
  { id: "pr_fix", label: "Fixing PR feedback", phase: 5, skill: "platform-skill", icon: "🔧" },
  { id: "pr_repush", label: "Re-push + IA Review", phase: 5, skill: "ia-reviewer", icon: "🔄" },
];

const PHASE_LABELS = { 0: "Phase 0 — Spec Review", 1: "Phase 1 — Plan", 2: "Phase 2 — Implement", 3: "Phase 3 — Quality Gate", 4: "Phase 4 — Ship", 5: "Phase 5 — PR Feedback" };

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

const init = { projects: [], tasks: [], agents: [], logs: [], customSkills: [], settings: { maxConcurrent: 3, defaultModel: "sonnet", maxReviewLoops: 5 } };

function reducer(s, a) {
  switch (a.type) {
    case "ADD_PROJECT": return { ...s, projects: [...s.projects, a.p] };
    case "UPD_PROJECT": return { ...s, projects: s.projects.map(p => p.id === a.p.id ? { ...p, ...a.p } : p) };
    case "DEL_PROJECT": return { ...s, projects: s.projects.filter(p => p.id !== a.id) };
    case "ADD_TASK": return { ...s, tasks: [...s.tasks, a.p] };
    case "UPD_TASK": return { ...s, tasks: s.tasks.map(t => t.id === a.p.id ? { ...t, ...a.p } : t) };
    case "DEL_TASK": return { ...s, tasks: s.tasks.filter(t => t.id !== a.id) };
    case "ADD_SKILL": return { ...s, customSkills: [...s.customSkills, a.p] };
    case "DEL_SKILL": return { ...s, customSkills: s.customSkills.filter(sk => sk.id !== a.id) };
    case "LOG": return { ...s, logs: [a.p, ...s.logs].slice(0, 500) };
    case "SET": return { ...s, settings: { ...s.settings, ...a.p } };
    case "AG": { const e = s.agents.find(x => x.tid === a.p.tid); return e ? { ...s, agents: s.agents.map(x => x.tid === a.p.tid ? { ...x, ...a.p } : x) } : { ...s, agents: [...s.agents, a.p] }; }
    case "AG_RM": return { ...s, agents: s.agents.filter(x => x.tid !== a.id) };
    default: return s;
  }
}

const gid = () => Math.random().toString(36).slice(2, 9);
const ts = () => new Date().toLocaleTimeString("en-US", { hour12: false });

const ST = {
  queued:       { l: "Queued",             c: "bg-amber-100 text-amber-800",    d: "bg-amber-400" },
  spec_review:  { l: "Reviewing Spec",    c: "bg-cyan-100 text-cyan-800",      d: "bg-cyan-500 animate-pulse" },
  spec_feedback:{ l: "Spec: Refine",      c: "bg-cyan-100 text-cyan-800",      d: "bg-cyan-400" },
  planning:     { l: "Planning",          c: "bg-sky-100 text-sky-800",        d: "bg-sky-500 animate-pulse" },
  implementing: { l: "Implementing",      c: "bg-blue-100 text-blue-800",      d: "bg-blue-500 animate-pulse" },
  reviewing:    { l: "IA Review",         c: "bg-purple-100 text-purple-800",  d: "bg-purple-500 animate-pulse" },
  fixing:       { l: "Fixing",            c: "bg-orange-100 text-orange-800",  d: "bg-orange-500 animate-pulse" },
  shipping:     { l: "Commit/Push",       c: "bg-teal-100 text-teal-800",      d: "bg-teal-500 animate-pulse" },
  pr_feedback:  { l: "Waiting PR Review", c: "bg-pink-100 text-pink-800",      d: "bg-pink-400" },
  pr_fixing:    { l: "Fixing PR Feedback",c: "bg-orange-100 text-orange-800",  d: "bg-orange-500 animate-pulse" },
  completed:    { l: "Completed",         c: "bg-emerald-100 text-emerald-800",d: "bg-emerald-500" },
  failed:       { l: "Failed",            c: "bg-red-100 text-red-800",        d: "bg-red-500" },
};

// ═══════════════════════════════════════════════════════════════
// SIMULATION — follows CLAUDE.md workflow exactly
// ═══════════════════════════════════════════════════════════════

function useSim(dispatch) {
  const runAgent = useCallback((task, startPhaseIdx = 0) => {
    const phases = WORKFLOW_PHASES;
    const isRerun = startPhaseIdx > 0;
    const isSpecContinue = startPhaseIdx === -1; // continuing after spec refinement
    const runPhases = isRerun
      ? phases.filter(p => ["gate_phpunit", "gate_review", "gate_fix", "gate_recheck", "gate_pass", "commit_push", "ci_review"].includes(p.id))
      : isSpecContinue
        ? phases.filter(p => !["spec_analyze", "spec_validate", "spec_ok", "pr_waiting", "pr_fetch", "pr_fix", "pr_repush"].includes(p.id))
        : phases.filter(p => !["pr_waiting", "pr_fetch", "pr_fix", "pr_repush"].includes(p.id));

    let i = 0;
    const pr = task.prNumber || Math.floor(Math.random() * 900) + 100;

    const initialStatus = isRerun ? "fixing" : isSpecContinue ? "planning" : "spec_review";
    dispatch({ type: "UPD_TASK", p: { id: task.id, status: initialStatus, prNumber: pr } });
    dispatch({ type: "AG", p: { tid: task.id, phaseIdx: 0, progress: 0, reviewLoop: isRerun ? (task.reviewCycle || 1) : 0, pr } });
    dispatch({ type: "LOG", p: { t: ts(), p: task.projectName, m: isRerun ? `🔄 Re-run: Fixing PR #${pr} feedback (cycle ${(task.reviewCycle || 0) + 1})` : isSpecContinue ? `✅ Spec refined → continuing to Plan` : `🔎 Spec Review → ${task.title}`, k: "info" } });

    // Simulate spec feedback pause (50% chance for demo — in real system, agent decides)
    const specNeedsFeedback = !isRerun && !isSpecContinue && (!task.description || task.description.length < 50 || !task.acceptanceCriteria || task.acceptanceCriteria.length === 0);

    const iv = setInterval(() => {
      i++;

      // Check if we should pause for spec feedback after spec_validate phase
      if (!isRerun && !isSpecContinue && runPhases[i]?.id === "spec_ok" && specNeedsFeedback) {
        clearInterval(iv);
        const suggestions = [];
        if (!task.description || task.description.length < 50) suggestions.push("The description is too short — add more detail about the expected functionality");
        if (!task.acceptanceCriteria || task.acceptanceCriteria.length === 0) suggestions.push("No acceptance criteria — define what 'done' means");
        if (!task.images || task.images.length === 0) suggestions.push("Consider adding mockups or wireframes for visual context");

        dispatch({ type: "UPD_TASK", p: { id: task.id, status: "spec_feedback", specSuggestions: suggestions } });
        dispatch({ type: "AG_RM", id: task.id });
        dispatch({ type: "LOG", p: { t: ts(), p: task.projectName, m: `📐 Spec incomplete → ${suggestions.length} suggestions for refinement`, k: "error" } });
        return;
      }

      if (i >= runPhases.length) {
        clearInterval(iv);
        dispatch({ type: "UPD_TASK", p: { id: task.id, status: "pr_feedback", prNumber: pr, reviewCycle: (task.reviewCycle || 0) + (isRerun ? 1 : 0) } });
        dispatch({ type: "AG_RM", id: task.id });
        dispatch({ type: "LOG", p: { t: ts(), p: task.projectName, m: `⏸️ PR #${pr} pushed → waiting for human review`, k: "ok" } });
        return;
      }

      const ph = runPhases[i];
      const prog = Math.round((i / (runPhases.length - 1)) * 100);

      const statusMap = {
        spec_analyze: "spec_review", spec_validate: "spec_review", spec_ok: "spec_review",
        plan_decompose: "planning", plan_risks: "planning", plan_approval: "planning",
        impl_code: "implementing", impl_tests: "implementing",
        gate_phpunit: "reviewing", gate_review: "reviewing", gate_fix: "fixing", gate_recheck: "reviewing", gate_pass: "reviewing",
        commit_push: "shipping", ci_review: "shipping",
      };
      dispatch({ type: "UPD_TASK", p: { id: task.id, status: statusMap[ph.id] || "implementing" } });
      dispatch({ type: "AG", p: { tid: task.id, phaseIdx: i, progress: prog, pr, currentPhase: ph, reviewLoop: isRerun ? (task.reviewCycle || 1) : 0 } });
      dispatch({ type: "LOG", p: { t: ts(), p: task.projectName, m: `${ph.icon} ${ph.label}`, k: ph.id === "gate_pass" || ph.id === "spec_ok" ? "ok" : "step" } });
    }, 2200);
  }, [dispatch]);

  return runAgent;
}

// ═══════════════════════════════════════════════════════════════
// ATOMS
// ═══════════════════════════════════════════════════════════════

const Badge = ({ s }) => { const c = ST[s] || ST.queued; return <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${c.c}`}><span className={`w-1.5 h-1.5 rounded-full ${c.d}`} />{c.l}</span>; };

function ProgressBar({ agent }) {
  if (!agent) return null;
  const ph = agent.currentPhase;
  const phaseNum = ph?.phase || 1;
  const colors = { 0: "from-cyan-500 to-cyan-600", 1: "from-sky-500 to-sky-600", 2: "from-blue-500 to-blue-600", 3: "from-purple-500 to-purple-600", 4: "from-teal-500 to-teal-600", 5: "from-pink-500 to-pink-600" };
  return (
    <div className="space-y-1.5">
      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full bg-gradient-to-r ${colors[phaseNum] || colors[1]} rounded-full transition-all duration-700`} style={{ width: `${agent.progress}%` }} />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">{ph?.icon}</span>
          <span className="text-xs text-gray-500 font-medium">{ph?.label}</span>
        </div>
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
          phaseNum === 0 ? "bg-cyan-50 text-cyan-600" :
          phaseNum === 1 ? "bg-sky-50 text-sky-600" :
          phaseNum === 2 ? "bg-blue-50 text-blue-600" :
          phaseNum === 3 ? "bg-purple-50 text-purple-600" :
          phaseNum === 5 ? "bg-pink-50 text-pink-600" :
          "bg-teal-50 text-teal-600"
        }`}>{PHASE_LABELS[phaseNum]}</span>
      </div>
    </div>
  );
}

function SkillTag({ id, locked, removable, onRemove, size = "sm" }) {
  const s = findSkill(id);
  const name = s?.name || id.split("/").pop();
  const isCore = s?.locked || locked;
  const isReviewer = id === "ia-reviewer";
  const base = size === "xs" ? "px-1.5 py-0.5 text-[10px] leading-tight" : "px-2 py-0.5 text-xs";
  const style = isReviewer ? "bg-purple-100 text-purple-700 border border-purple-200" : isCore ? "bg-indigo-50 text-indigo-700 border border-indigo-200" : "bg-gray-100 text-gray-600 border border-gray-200";
  return (
    <span className={`inline-flex items-center gap-1 ${base} rounded-md font-medium ${style}`}>
      {isCore && <span className="text-[8px]">{isReviewer ? "🔍" : "🔒"}</span>}{name}
      {removable && !isCore && <button onClick={() => onRemove?.(id)} className="ml-0.5 hover:text-red-500">×</button>}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════

function Sidebar({ view, setView, counts }) {
  const items = [
    { id: "dashboard", l: "Dashboard", i: "◉" },
    { id: "tasks", l: "Tasks", i: "☰", n: counts.tasks },
    { id: "projects", l: "Projects", i: "◫", n: counts.projects },
    { id: "workflow", l: "Workflow", i: "⟳" },
    { id: "skills", l: "Skills", i: "⚡" },
    { id: "logs", l: "Logs", i: "❯_" },
    { id: "settings", l: "Settings", i: "⚙" },
  ];
  return (
    <div className="w-56 bg-gray-950 text-gray-300 flex flex-col flex-shrink-0">
      <div className="p-5 border-b border-gray-800"><div className="flex items-center gap-2.5"><div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center text-white text-sm font-bold">A</div><div><h1 className="text-white text-sm font-bold">Agent Hub</h1><p className="text-gray-500 text-xs">SDD Orchestrator</p></div></div></div>
      <nav className="flex-1 p-3 space-y-0.5">{items.map(i => (
        <button key={i.id} onClick={() => setView(i.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${view === i.id ? "bg-indigo-600/20 text-indigo-300 font-medium" : "hover:bg-gray-800/60 text-gray-400"}`}>
          <span className="w-5 text-center opacity-70">{i.i}</span><span className="flex-1 text-left">{i.l}</span>
          {i.n > 0 && <span className="bg-gray-800 text-gray-400 text-xs px-1.5 py-0.5 rounded-md">{i.n}</span>}
        </button>
      ))}</nav>
      <div className="p-4 border-t border-gray-800"><div className="flex items-center gap-2 text-xs text-gray-500"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />Claude Code CLI</div><div className="text-xs text-gray-600 mt-1">Plan Max · {CORE_SKILLS.length} Core Skills 🔒</div></div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

function DashboardView({ state }) {
  const agentRunning = state.tasks.filter(t => !["queued", "completed", "failed", "pr_feedback", "spec_feedback"].includes(t.status));
  const specWaiting = state.tasks.filter(t => t.status === "spec_feedback");
  const prWaiting = state.tasks.filter(t => t.status === "pr_feedback");
  const pendingAction = specWaiting.length + prWaiting.length;
  const runCount = agentRunning.length;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Dashboard</h2>
        <div className="text-xs text-gray-400 bg-gray-50 px-3 py-1.5 rounded-lg border"><span className={`inline-block w-2 h-2 rounded-full mr-1.5 align-middle ${runCount > 0 ? "bg-blue-500 animate-pulse" : "bg-gray-300"}`} />{runCount}/{state.settings.maxConcurrent} agents</div>
      </div>
      <div className="grid grid-cols-5 gap-4">
        {[
          { l: "Active Agents", v: runCount, s: "text-blue-600 bg-blue-50 border-blue-200" },
          { l: "Require Action", v: pendingAction, s: pendingAction > 0 ? "text-cyan-600 bg-cyan-50 border-cyan-200" : "text-gray-400 bg-gray-50 border-gray-200" },
          { l: "Queued", v: state.tasks.filter(t => t.status === "queued").length, s: "text-amber-600 bg-amber-50 border-amber-200" },
          { l: "Completed", v: state.tasks.filter(t => t.status === "completed").length, s: "text-emerald-600 bg-emerald-50 border-emerald-200" },
          { l: "Projects", v: state.projects.length, s: "text-purple-600 bg-purple-50 border-purple-200" },
        ].map(x => <div key={x.l} className={`border rounded-xl p-4 ${x.s}`}><p className="text-xs text-gray-500 font-medium">{x.l}</p><p className="text-2xl font-bold mt-1">{x.v}</p></div>)}
      </div>

      {agentRunning.map(task => { const ag = state.agents.find(a => a.tid === task.id); return (
        <div key={task.id} className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3"><div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-700 text-xs font-bold">{task.projectName?.[0]?.toUpperCase()}</div><div><p className="text-sm font-semibold text-gray-800">{task.title}</p><p className="text-xs text-gray-400">{task.projectName}</p></div></div>
            <div className="flex items-center gap-2">{ag?.pr && <span className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded font-mono">PR #{ag.pr}</span>}<Badge s={task.status} /></div>
          </div>
          <ProgressBar agent={ag} />
        </div>
      ); })}

      {specWaiting.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-cyan-700 flex items-center gap-1.5">📐 Spec needs refinement ({specWaiting.length})</h3>
          {specWaiting.map(task => (
            <div key={task.id} className="bg-white border border-cyan-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-cyan-100 rounded-lg flex items-center justify-center text-cyan-700 text-xs font-bold">{task.projectName?.[0]?.toUpperCase()}</div>
                  <div><p className="text-sm font-semibold text-gray-800">{task.title}</p><p className="text-xs text-gray-400">{task.projectName}</p></div>
                </div>
                <Badge s="spec_feedback" />
              </div>
              {task.specSuggestions?.length > 0 && (
                <div className="bg-cyan-50 rounded-lg p-3 space-y-1.5">
                  {task.specSuggestions.map((s, i) => <div key={i} className="flex items-start gap-2"><span className="text-cyan-500 text-xs mt-0.5">→</span><span className="text-xs text-cyan-800">{s}</span></div>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {prWaiting.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-pink-700 flex items-center gap-1.5">⏸️ Waiting for PR Review ({prWaiting.length})</h3>
          {prWaiting.map(task => (
            <div key={task.id} className="bg-white border border-pink-200 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-pink-100 rounded-lg flex items-center justify-center text-pink-700 text-xs font-bold">{task.projectName?.[0]?.toUpperCase()}</div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{task.title}</p>
                  <p className="text-xs text-gray-400">{task.projectName}{task.reviewCycle > 0 && <span className="ml-1 text-pink-500">· cycle #{task.reviewCycle}</span>}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded font-mono">PR #{task.prNumber}</span>
                <Badge s="pr_feedback" />
              </div>
            </div>
          ))}
        </div>
      )}

      {state.logs.length > 0 && <div className="bg-gray-950 rounded-xl overflow-hidden"><div className="px-4 py-2.5 border-b border-gray-800"><h3 className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Activity</h3></div><div className="p-3 max-h-48 overflow-y-auto font-mono text-xs space-y-1">{state.logs.slice(0, 15).map((l, i) => <div key={i} className="flex gap-3 text-gray-400"><span className="text-gray-600 flex-shrink-0">{l.t}</span><span className="text-indigo-400 w-28 truncate flex-shrink-0">{l.p}</span><span className={l.k === "ok" ? "text-emerald-400" : l.k === "error" ? "text-red-400" : "text-gray-300"}>{l.m}</span></div>)}</div></div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WORKFLOW VIEW — Visual diagram from CLAUDE.md
// ═══════════════════════════════════════════════════════════════

function WorkflowView() {
  const phases = [
    { num: 0, title: "Spec Review", color: "border-cyan-300 bg-cyan-50", badge: "bg-cyan-500", skill: "spec-compliance", isConditional: true, steps: [
      "The agent analyzes the spec (description + acceptance criteria)",
      "Evaluates: Is the functionality clear? Criteria defined? Sufficient context?",
      "If OK → automatically proceeds to Phase 1",
      "If incomplete → pauses with suggestions for the user to refine",
      "The user edits the spec or accepts as-is → continues",
    ]},
    { num: 1, title: "Plan", color: "border-sky-300 bg-sky-50", badge: "bg-sky-500", skill: "senior-engineering", steps: ["Define success criteria (done)", "Decompose into testable units", "Identify risks, deps, rollback", "Present plan for approval"] },
    { num: 2, title: "Implement", color: "border-blue-300 bg-blue-50", badge: "bg-blue-500", skill: "platform-skill + TDD", steps: ["Code following the project's coding standards", "Unit tests for each public method", "Incremental changes — always runnable"] },
    { num: 3, title: "Quality Gate", color: "border-purple-300 bg-purple-50", badge: "bg-purple-500", skill: "ia-reviewer", steps: ["Tests — all pass before continuing", "IA Review: Security → Standards → Validation → Tests → Architecture", "If Critical/High/Medium → FIX → back to step 1", "Automatic loop until 'Ready to merge'"], isLoop: true },
    { num: 4, title: "Ship", color: "border-teal-300 bg-teal-50", badge: "bg-teal-500", skill: "git-workflow", steps: ["Commit & Push (conventional commits)", "CI: GitHub Actions claude-sonnet-4-6 review"] },
    { num: 5, title: "PR Feedback", color: "border-pink-300 bg-pink-50", badge: "bg-pink-500", skill: "manual → agent", isManual: true, steps: [
      "⏸️ The agent stops — waits for human review on GitHub",
      "The reviewer leaves comments on the PR (variable time)",
      "📥 The user clicks \"Fetch & Fix\" in the dashboard",
      "The agent runs: gh pr view --comments → reads feedback",
      "Re-executes: Fix → Quality Gate (IA Review) → Re-push",
      "Returns to ⏸️ waiting — repeats until approved",
      "✅ The user clicks \"Approve\" → task completed",
    ]},
  ];

  return (
    <div className="space-y-6">
      <div><h2 className="text-xl font-bold text-gray-900">Mandatory Workflow</h2><p className="text-sm text-gray-500 mt-0.5">Aligned with CLAUDE.md — every task follows this complete flow.</p></div>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="space-y-4">
          {phases.map((ph, idx) => (
            <div key={ph.num}>
              <div className={`border-2 ${ph.color} rounded-xl p-4`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-7 h-7 ${ph.badge} text-white rounded-lg flex items-center justify-center text-xs font-bold`}>{ph.num}</span>
                    <h4 className="text-sm font-bold text-gray-800">Phase {ph.num} — {ph.title}</h4>
                    {ph.isLoop && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">🔄 Automatic loop</span>}
                    {ph.isManual && <span className="text-xs bg-pink-100 text-pink-700 px-2 py-0.5 rounded-full font-semibold">⏸️ Manual — user decides</span>}
                    {ph.isConditional && <span className="text-xs bg-cyan-100 text-cyan-700 px-2 py-0.5 rounded-full font-semibold">🔎 Auto or pause if incomplete</span>}
                  </div>
                  <span className="text-xs text-gray-400 font-mono">{ph.skill}</span>
                </div>
                <div className="space-y-1.5 ml-10">
                  {ph.steps.map((step, si) => (
                    <div key={si} className="flex items-start gap-2">
                      <span className="text-xs text-gray-400 mt-0.5">{si + 1}.</span>
                      <span className="text-sm text-gray-600">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
              {idx < phases.length - 1 && <div className="flex justify-center py-1"><span className="text-gray-300 text-lg">↓</span></div>}
            </div>
          ))}
        </div>
      </div>

      {/* PR Feedback detail card — complements Phase 5 */}
      <div className="bg-pink-50 border border-pink-200 rounded-xl p-5">
        <h4 className="text-sm font-bold text-pink-800 mb-2">📥 Detail: Fetch & Fix (manual cycle)</h4>
        <p className="text-xs text-pink-600 mb-3">This step is manual because human review time is unpredictable. The agent does NOT proceed on its own — you decide when there are comments and when to approve.</p>
        <div className="bg-white/70 rounded-lg p-4 font-mono text-xs text-gray-600 space-y-2">
          <p className="text-gray-400">{"// Actual flow the agent executes on 'Fetch & Fix':"}</p>
          <p>1. <span className="text-pink-600">gh pr view #{"{PR}"} --comments --json comments</span></p>
          <p>2. Parse new comments since last cycle</p>
          <p>3. For each comment requiring a change:</p>
          <p className="ml-4">a. Locate referenced file:line</p>
          <p className="ml-4">b. Apply fix following the project's coding standards</p>
          <p className="ml-4">c. Write/update test for the change</p>
          <p>4. <span className="text-purple-600">IA Reviewer</span> → Full Quality Gate (Security → Standards → Tests)</p>
          <p>5. <span className="text-teal-600">git commit + push</span> (conventional commit: fix(pr): address review feedback)</p>
          <p>6. <span className="text-pink-600">⏸️ Returns to waiting</span> → cycle repeats</p>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <div className="flex items-center gap-2"><span className="w-8 h-8 bg-orange-500 text-white rounded-lg flex items-center justify-center text-sm">📥</span><div><p className="text-xs font-bold text-gray-700">Fetch & Fix</p><p className="text-[10px] text-gray-500">Reads comments and re-runs the agent</p></div></div>
          <div className="flex items-center gap-2"><span className="w-8 h-8 bg-emerald-600 text-white rounded-lg flex items-center justify-center text-sm">✅</span><div><p className="text-xs font-bold text-gray-700">Approve</p><p className="text-[10px] text-gray-500">No more changes — task completed</p></div></div>
        </div>
      </div>

      <div className="bg-purple-50 border border-purple-200 rounded-xl p-5">
        <h4 className="text-sm font-bold text-purple-800 mb-2">🔍 IA Reviewer — Quality Gate Detail</h4>
        <p className="text-xs text-purple-600 mb-3">Runs in Phase 3 (automatic) and in each Phase 5 cycle (after PR feedback fix):</p>
        <div className="grid grid-cols-5 gap-2">
          {[
            { l: "Security", sev: "CRITICAL", c: "bg-red-100 text-red-700 border-red-200", items: "Injection, XSS, CSRF, Auth, Input Sanitization" },
            { l: "Standards", sev: "HIGH", c: "bg-orange-100 text-orange-700 border-orange-200", items: "Stack coding standards (WPCS, ESLint, etc)" },
            { l: "Data Validation", sev: "MEDIUM", c: "bg-yellow-100 text-yellow-700 border-yellow-200", items: "Type checks, boundary validation, null safety" },
            { l: "Testing", sev: "MEDIUM", c: "bg-blue-100 text-blue-700 border-blue-200", items: "Coverage, security tests, edge cases, cleanup" },
            { l: "Architecture", sev: "LOW", c: "bg-gray-100 text-gray-600 border-gray-200", items: "Patterns, module registration, no dead code" },
          ].map(cat => (
            <div key={cat.l} className={`${cat.c} border rounded-lg p-2.5`}>
              <p className="text-xs font-bold">{cat.l}</p>
              <p className="text-[10px] font-semibold opacity-70 mb-1">{cat.sev}</p>
              <p className="text-[10px] opacity-80">{cat.items}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SKILLS VIEW
// ═══════════════════════════════════════════════════════════════

function SkillsView({ state, dispatch }) {
  const [target, setTarget] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState(state.projects[0]?.id || null);
  const [addingGlobal, setAddingGlobal] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [newSkillUrl, setNewSkillUrl] = useState("");

  // Simulate: global skills = CORE_SKILLS read from ~/.claude/settings.json
  const [globalSkills, setGlobalSkills] = useState(() => CORE_SKILLS.map(s => ({ ...s, active: true })));

  const toggleGlobal = (skillId) => {
    setGlobalSkills(prev => prev.map(s => s.id === skillId ? { ...s, active: !s.active } : s));
    const sk = globalSkills.find(s => s.id === skillId);
    dispatch({ type: "LOG", p: { t: ts(), p: "global", m: `${sk?.active ? "🗑" : "✅"} ${sk?.name} ${sk?.active ? "deactivated" : "activated"} in ~/.claude/settings.json`, k: sk?.active ? "step" : "ok" } });
  };

  const addGlobalSkill = () => {
    if (!newSkillUrl.trim()) return;
    const name = newSkillUrl.split("/").pop() || newSkillUrl;
    setGlobalSkills(prev => [...prev, { id: newSkillUrl, name, desc: "Manually added skill", active: true }]);
    dispatch({ type: "LOG", p: { t: ts(), p: "global", m: `📦 ${newSkillUrl} added to ~/.claude/settings.json`, k: "ok" } });
    setNewSkillUrl("");
    setAddingGlobal(false);
  };

  const toggleProjectSkill = (skillId, projId) => {
    const proj = state.projects.find(p => p.id === projId);
    if (!proj) return;
    const has = proj.optionalSkills?.includes(skillId);
    dispatch({ type: "UPD_PROJECT", p: { id: projId, optionalSkills: has ? (proj.optionalSkills || []).filter(s => s !== skillId) : [...(proj.optionalSkills || []), skillId] } });
    dispatch({ type: "LOG", p: { t: ts(), p: proj.name, m: `${has ? "🗑" : "📦"} ${findSkill(skillId)?.name || skillId} ${has ? "OFF" : "ON"} in ${proj.path}/.claude/settings.json`, k: has ? "step" : "ok" } });
  };

  const addProjectSkill = () => {
    if (!newSkillUrl.trim() || !selectedProject) return;
    const proj = state.projects.find(p => p.id === selectedProject);
    if (!proj) return;
    if (!OPTIONAL_SKILLS.find(s => s.id === newSkillUrl)) {
      OPTIONAL_SKILLS.push({ id: newSkillUrl, name: newSkillUrl.split("/").pop() || newSkillUrl, desc: "Custom skill", category: "Custom", author: "user", tags: [] });
    }
    dispatch({ type: "UPD_PROJECT", p: { id: selectedProject, optionalSkills: [...(proj.optionalSkills || []), newSkillUrl] } });
    dispatch({ type: "LOG", p: { t: ts(), p: proj.name, m: `📦 ${newSkillUrl} added to ${proj.path}/.claude/settings.json`, k: "ok" } });
    setNewSkillUrl("");
    setAddingProject(false);
  };

  const selProj = state.projects.find(p => p.id === selectedProject);

  const filtered = OPTIONAL_SKILLS.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q) || s.tags?.some(t => t.includes(q)) || s.author.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div><h2 className="text-xl font-bold text-gray-900">Skills</h2><p className="text-sm text-gray-500 mt-0.5">Manage Claude Code skills. Changes are written to configuration files.</p></div>

      {/* GLOBAL SKILLS */}
      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-xs font-bold text-indigo-700 uppercase tracking-wider">🔒 Global Skills ({globalSkills.filter(s => s.active).length}/{globalSkills.length})</h3>
            <p className="text-xs text-indigo-400 mt-0.5 font-mono">~/.claude/settings.json → settingSources[]</p>
          </div>
          <button onClick={() => setAddingGlobal(!addingGlobal)} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1.5 rounded-lg">+ Add Global Skill</button>
        </div>

        {addingGlobal && (
          <div className="mb-3 flex items-center gap-2 bg-white rounded-lg p-2.5 border border-indigo-200">
            <input type="text" value={newSkillUrl} onChange={e => setNewSkillUrl(e.target.value)} placeholder="org/skill-name (e.g.: ramziddin/solid-skills)" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-mono" onKeyDown={e => e.key === "Enter" && addGlobalSkill()} />
            <button onClick={addGlobalSkill} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-4 py-2 rounded-lg">Add</button>
            <button onClick={() => { setAddingGlobal(false); setNewSkillUrl(""); }} className="text-xs text-gray-400">×</button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {globalSkills.map(s => (
            <div key={s.id} className={`border rounded-lg p-3 transition-all ${s.active ? "bg-white/80 border-indigo-100" : "bg-gray-100/50 border-gray-200 opacity-60"} ${s.id === "ia-reviewer" ? "border-purple-200 ring-1 ring-purple-100" : ""}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs">{s.id === "ia-reviewer" ? "🔍" : s.active ? "✅" : "⬜"}</span>
                  <h4 className={`text-xs font-bold ${s.active ? "text-gray-800" : "text-gray-400"}`}>{s.name}</h4>
                </div>
                <button onClick={() => toggleGlobal(s.id)} className={`text-[10px] px-2 py-0.5 rounded font-medium ${s.active ? "bg-emerald-100 text-emerald-700 hover:bg-red-100 hover:text-red-600" : "bg-gray-200 text-gray-500 hover:bg-emerald-100 hover:text-emerald-700"}`}>
                  {s.active ? "ON" : "OFF"}
                </button>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed">{s.desc}</p>
              <p className="text-[10px] text-gray-300 font-mono mt-1">{s.id}</p>
            </div>
          ))}
        </div>
      </div>

      {/* PROJECT SKILLS */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wider">📁 Project Skills</h3>
            {selProj && <p className="text-xs text-gray-400 mt-0.5 font-mono">{selProj.path}/.claude/settings.json</p>}
          </div>
          <div className="flex items-center gap-2">
            <select value={selectedProject || ""} onChange={e => setSelectedProject(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500">
              {state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {selProj && <button onClick={() => setAddingProject(!addingProject)} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1.5 rounded-lg">+ Add</button>}
          </div>
        </div>

        {addingProject && selProj && (
          <div className="mb-3 flex items-center gap-2 bg-gray-50 rounded-lg p-2.5 border border-gray-200">
            <input type="text" value={newSkillUrl} onChange={e => setNewSkillUrl(e.target.value)} placeholder="org/skill-name (e.g.: wordpress-pro)" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-mono" onKeyDown={e => e.key === "Enter" && addProjectSkill()} />
            <button onClick={addProjectSkill} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-4 py-2 rounded-lg">Add to {selProj.name}</button>
            <button onClick={() => { setAddingProject(false); setNewSkillUrl(""); }} className="text-xs text-gray-400">×</button>
          </div>
        )}

        {selProj ? (
          <div>
            {(!selProj.optionalSkills || selProj.optionalSkills.length === 0) ? (
              <div className="text-center py-8 text-gray-300">
                <p className="text-sm">No optional skills</p>
                <p className="text-xs mt-1">Add skills from the catalog or enter the ID manually</p>
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                {selProj.optionalSkills.map(sId => {
                  const sk = findSkill(sId);
                  return (
                    <div key={sId} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <div className="flex items-center gap-3">
                        <span className="text-xs">✅</span>
                        <div>
                          <h4 className="text-xs font-bold text-gray-800">{sk?.name || sId}</h4>
                          {sk && <p className="text-[10px] text-gray-400">{sk.desc}</p>}
                        </div>
                      </div>
                      <button onClick={() => toggleProjectSkill(sId, selProj.id)} className="text-xs bg-red-50 text-red-500 hover:bg-red-100 font-medium px-2.5 py-1 rounded">Deactivate</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Config file preview */}
            <div className="bg-gray-950 rounded-lg p-3 mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-gray-500 font-mono">{selProj.path}/.claude/settings.json</span>
                <span className="text-[10px] text-gray-600">preview</span>
              </div>
              <pre className="text-xs text-gray-300 font-mono">{JSON.stringify({ settingSources: selProj.optionalSkills || [] }, null, 2)}</pre>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-300"><p className="text-sm">Select a project</p></div>
        )}
      </div>

      {/* CATALOG */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wider">📚 Available Skills Catalog</h3>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs w-48 outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {filtered.map(s => {
            const usedIn = state.projects.filter(p => p.optionalSkills?.includes(s.id));
            return (
              <div key={s.id} className="bg-white border border-gray-200 rounded-xl p-4 hover:border-indigo-200 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5"><h4 className="text-sm font-bold text-gray-800">{s.name}</h4><span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{s.category}</span></div>
                    <p className="text-xs text-gray-500 mb-1">{s.desc}</p>
                    <p className="text-xs text-gray-300 font-mono">{s.id}</p>
                  </div>
                  <div className="relative flex-shrink-0 ml-3">
                    <button onClick={() => setTarget(target === s.id ? null : s.id)} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1.5 rounded-lg whitespace-nowrap">
                      {usedIn.length > 0 ? `ON (${usedIn.length})` : "Activate"}
                    </button>
                    {target === s.id && state.projects.length > 0 && (
                      <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-20 py-1 min-w-[220px]">
                        <p className="px-3 py-1.5 text-xs text-gray-400 font-semibold border-b border-gray-100">Toggle per project:</p>
                        {state.projects.map(p => { const on = p.optionalSkills?.includes(s.id); return (
                          <button key={p.id} onClick={() => toggleProjectSkill(s.id, p.id)} className="w-full text-left px-3 py-2.5 text-xs hover:bg-gray-50 flex items-center justify-between">
                            <span className="text-gray-700 font-medium">{p.name}</span>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${on ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>{on ? "● ON" : "○ OFF"}</span>
                          </button>
                        ); })}
                      </div>
                    )}
                  </div>
                </div>
                {usedIn.length > 0 && <div className="mt-2 pt-2 border-t border-gray-50 flex items-center gap-1.5 flex-wrap">{usedIn.map(p => <span key={p.id} className="text-xs bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-medium">{p.name}</span>)}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <h4 className="text-xs font-bold text-gray-600 mb-2">ℹ️ How does it work?</h4>
        <div className="grid grid-cols-2 gap-4 text-xs text-gray-500">
          <div>
            <p className="font-semibold text-gray-700 mb-1">Global Skills</p>
            <p>Read from and written to <code className="bg-gray-200 px-1 rounded text-gray-700">~/.claude/settings.json</code>. Apply to ALL projects. Claude Code loads them automatically on execution.</p>
          </div>
          <div>
            <p className="font-semibold text-gray-700 mb-1">Project Skills</p>
            <p>Read from and written to <code className="bg-gray-200 px-1 rounded text-gray-700">{"{project}"}/.claude/settings.json</code>. Only apply when Claude Code runs in that directory.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROJECTS
// ═══════════════════════════════════════════════════════════════

function ProjectsView({ state, dispatch }) {
  const [form, setForm] = useState(null);

  const save = () => {
    if (!form.name) return;
    if (form._new) dispatch({ type: "ADD_PROJECT", p: { id: gid(), name: form.name, path: form.path, repo: form.repo, description: form.description || "", optionalSkills: form.optionalSkills || [] } });
    else dispatch({ type: "UPD_PROJECT", p: { id: form.id, name: form.name, path: form.path, repo: form.repo, description: form.description || "", optionalSkills: form.optionalSkills || [] } });
    setForm(null);
  };

  const toggleSkill = (skillId) => {
    if (!form) return;
    const has = form.optionalSkills?.includes(skillId);
    setForm({ ...form, optionalSkills: has ? (form.optionalSkills || []).filter(s => s !== skillId) : [...(form.optionalSkills || []), skillId] });
  };

  const skillsByCategory = {};
  OPTIONAL_SKILLS.forEach(s => { if (!skillsByCategory[s.category]) skillsByCategory[s.category] = []; skillsByCategory[s.category].push(s); });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-bold text-gray-900">Projects</h2><p className="text-sm text-gray-500 mt-0.5">{CORE_SKILLS.length} Core 🔒 always + toggleable optionals</p></div>
        <button onClick={() => setForm({ _new: true, name: "", path: "", repo: "", description: "", optionalSkills: [] })} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg">+ New</button>
      </div>
      {form && <div className="bg-white border border-indigo-200 rounded-xl p-5 space-y-5">
        <h3 className="text-sm font-bold text-gray-800">{form._new ? "New Project" : "Edit Project"}</h3>
        <div className="grid grid-cols-3 gap-4">
          <div><label className="block text-xs font-semibold text-gray-500 mb-1">Name</label><input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" /></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-1">Local path</label><input type="text" value={form.path} onChange={e => setForm({ ...form, path: e.target.value })} placeholder="/home/dev/my-project" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" /></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-1">GitHub Repo</label><input type="text" value={form.repo} onChange={e => setForm({ ...form, repo: e.target.value })} placeholder="org/repo" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" /></div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wider">Project Description</label>
          <textarea value={form.description || ""} onChange={e => setForm({ ...form, description: e.target.value })} rows={4}
            placeholder={"E.g.: WordPress theme for ticket marketplace.\nStack: PHP 8.1, WordPress 6.4, WooCommerce.\nConventions: WPCS, Gutenberg blocks, custom REST API.\nDomain: Events, tickets, users, wallets."}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-y" />
          <p className="text-xs text-gray-300 mt-1">This context is injected into every task in the project. The more detailed, the better the results.</p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wider">Project Optional Skills</label>
          <div className="bg-gray-50 rounded-lg p-3 space-y-3 max-h-64 overflow-y-auto">
            {Object.entries(skillsByCategory).map(([cat, skills]) => (
              <div key={cat}>
                <p className="text-xs text-gray-400 font-semibold mb-1.5">{cat}</p>
                <div className="flex flex-wrap gap-1.5">
                  {skills.map(skill => {
                    const on = form.optionalSkills?.includes(skill.id);
                    return (
                      <button key={skill.id} onClick={() => toggleSkill(skill.id)} title={skill.desc}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                          on ? "bg-indigo-50 border-indigo-300 text-indigo-700 shadow-sm" : "bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
                        }`}>
                        {skill.name}
                        {on && <span className="text-indigo-500 text-[10px]">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {form.optionalSkills?.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-gray-400 font-medium">{form.optionalSkills.length} active:</span>
              {form.optionalSkills.map(s => <SkillTag key={s} id={s} removable onRemove={() => toggleSkill(s)} size="xs" />)}
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-2 border-t border-gray-100"><button onClick={() => setForm(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button><button onClick={save} disabled={!form.name} className="bg-indigo-600 disabled:bg-gray-300 text-white text-sm font-medium px-5 py-2 rounded-lg">Save</button></div>
      </div>}
      {state.projects.map(p => (
        <div key={p.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
            <div className="flex items-center gap-3"><div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white font-bold text-sm">{p.name[0]?.toUpperCase()}</div><div><h4 className="text-sm font-bold text-gray-800">{p.name}</h4><p className="text-xs text-gray-400 font-mono">{p.repo || p.path}</p></div></div>
            <div className="flex items-center gap-3"><span className="text-xs text-gray-400">{CORE_SKILLS.length + (p.optionalSkills?.length || 0)} skills</span><button onClick={() => setForm({ ...p })} className="text-xs text-gray-400 hover:text-indigo-600">Edit</button><button onClick={() => dispatch({ type: "DEL_PROJECT", id: p.id })} className="text-xs text-gray-300 hover:text-red-500">×</button></div>
          </div>
          {p.description && <div className="px-5 pb-3 border-b border-gray-100"><p className="text-xs text-gray-500 whitespace-pre-wrap line-clamp-2">{p.description}</p></div>}
          </div>
          <div className="px-5 py-3 space-y-2">
            <div><p className="text-xs text-indigo-500 font-semibold mb-1.5">🔒 Core</p><div className="flex flex-wrap gap-1">{CORE_SKILLS.map(s => <SkillTag key={s.id} id={s.id} locked size="xs" />)}</div></div>
            <div><p className="text-xs text-gray-400 font-semibold mb-1.5">⚡ Optional {p.optionalSkills?.length > 0 && `(${p.optionalSkills.length} ON)`}</p>{p.optionalSkills?.length > 0 ? <div className="flex flex-wrap gap-1">{p.optionalSkills.map(s => <SkillTag key={s} id={s} removable onRemove={sid => dispatch({ type: "UPD_PROJECT", p: { id: p.id, optionalSkills: p.optionalSkills.filter(x => x !== sid) } })} size="xs" />)}</div> : <p className="text-xs text-gray-300 italic">None active</p>}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════════

function TasksView({ state, dispatch, onStart }) {
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [editing, setEditing] = useState(null); // edit form for task in detail
  const [form, setForm] = useState({ projectId: "", title: "", description: "", acceptanceCriteria: "", images: [], model: "sonnet" });

  const submit = () => {
    const proj = state.projects.find(p => p.id === form.projectId);
    if (!proj || !form.title) return;
    const criteria = form.acceptanceCriteria.split("\n").map(c => c.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
    dispatch({ type: "ADD_TASK", p: { id: gid(), ...form, projectName: proj.name, projectPath: proj.path, acceptanceCriteria: criteria, status: "queued", createdAt: ts() } });
    setCreating(false);
    setForm({ projectId: "", title: "", description: "", acceptanceCriteria: "", images: [], model: "sonnet" });
  };

  const start = task => {
    const running = state.tasks.filter(t => !["queued", "completed", "failed", "pr_feedback", "spec_feedback"].includes(t.status)).length;
    if (running >= state.settings.maxConcurrent) { dispatch({ type: "LOG", p: { t: ts(), p: task.projectName, m: `⚠️ Max. concurrency`, k: "error" } }); return; }
    onStart(task);
  };

  const fetchAndFix = task => {
    const running = state.tasks.filter(t => !["queued", "completed", "failed", "pr_feedback", "spec_feedback"].includes(t.status)).length;
    if (running >= state.settings.maxConcurrent) { dispatch({ type: "LOG", p: { t: ts(), p: task.projectName, m: `⚠️ Max. concurrency — wait for an agent to finish`, k: "error" } }); return; }
    dispatch({ type: "LOG", p: { t: ts(), p: task.projectName, m: `📥 Fetching PR #${task.prNumber} comments via gh cli...`, k: "step" } });
    onStart(task, 1);
  };

  const saveEdit = () => {
    if (!editing) return;
    const criteria = editing.acceptanceCriteria.split("\n").map(c => c.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
    const proj = state.projects.find(p => p.id === editing.projectId);
    const wasStarted = editing._origStatus && editing._origStatus !== "queued";
    const newStatus = wasStarted ? "queued" : editing._origStatus || "queued";
    dispatch({ type: "UPD_TASK", p: { id: editing.id, title: editing.title, description: editing.description, acceptanceCriteria: criteria, images: editing.images, model: editing.model, projectId: editing.projectId, projectName: proj?.name || editing.projectName, status: newStatus, reviewCycle: wasStarted ? 0 : (editing.reviewCycle || 0) } });
    dispatch({ type: "LOG", p: { t: ts(), p: proj?.name || editing.projectName, m: wasStarted ? `⚠️ Task edited → back to queue (full re-execution)` : `📝 Task updated: ${editing.title}`, k: wasStarted ? "error" : "step" } });
    setEditing(null);
  };

  // ── DETAIL VIEW ──
  const detailTask = detailId ? state.tasks.find(t => t.id === detailId) : null;
  if (detailTask) {
    const ag = state.agents.find(a => a.tid === detailTask.id);
    const proj = state.projects.find(p => p.id === detailTask.projectId);
    const isEditable = ["queued", "pr_feedback", "completed", "spec_feedback"].includes(detailTask.status);
    const taskLogs = state.logs.filter(l => l.p === detailTask.projectName).slice(0, 30);

    if (editing) {
      const editProj = state.projects.find(p => p.id === editing.projectId);
      return (
        <div className="space-y-5 max-w-2xl">
          <div className="flex items-center justify-between"><h2 className="text-xl font-bold text-gray-900">Edit Task</h2><button onClick={() => setEditing(null)} className="text-sm text-gray-400">Cancel</button></div>

          {editing._origStatus === "pr_feedback" && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <span className="text-lg">⚠️</span>
                <div>
                  <p className="text-sm font-semibold text-amber-800">This task has an active PR (#{editing.prNumber})</p>
                  <p className="text-xs text-amber-700 mt-1">There is already implemented code, written tests, and an open PR on GitHub. Saving changes will return the task to <strong>"Queued"</strong> and the agent will re-execute the full flow from Phase 1 (Plan) with the new spec.</p>
                  <p className="text-xs text-amber-600 mt-1.5">The existing PR will become obsolete — the agent will create a new one.</p>
                </div>
              </div>
            </div>
          )}

          {editing._origStatus === "completed" && (
            <div className="bg-red-50 border border-red-300 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <span className="text-lg">🔴</span>
                <div>
                  <p className="text-sm font-semibold text-red-800">This task has already been completed and approved</p>
                  <p className="text-xs text-red-700 mt-1">Saving changes will reopen the task and return it to <strong>"Queued"</strong> for a full re-execution. The entire flow (Plan → Implement → Quality Gate → Ship → PR Review) will run again with the updated spec.</p>
                  <p className="text-xs text-red-600 mt-1.5">Consider whether it's better to create a new task instead of editing this one.</p>
                </div>
              </div>
            </div>
          )}

          {editing.specSuggestions?.length > 0 && (
            <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <span className="text-lg">📐</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-cyan-800">Agent suggestions to refine the spec</p>
                  <div className="mt-2 space-y-1.5">{editing.specSuggestions.map((s, i) => <div key={i} className="flex items-start gap-2"><span className="text-cyan-500 text-xs mt-0.5">→</span><span className="text-xs text-cyan-700">{s}</span></div>)}</div>
                  <p className="text-xs text-cyan-600 mt-2">Adjust the description and criteria based on these suggestions. On save, the task returns to queue ready to start.</p>
                </div>
              </div>
            </div>
          )}
          <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wider">Project</label>
              <select value={editing.projectId} onChange={e => setEditing({ ...editing, projectId: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500">
                {state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {editProj && <div className="mt-2 bg-gray-50 rounded-lg p-2.5"><p className="text-xs text-gray-400 mb-1 font-medium">Skills:</p><div className="flex flex-wrap gap-1">{CORE_SKILLS.map(s => <SkillTag key={s.id} id={s.id} locked size="xs" />)}{editProj.optionalSkills?.map(s => <SkillTag key={s} id={s} size="xs" />)}</div></div>}
            </div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wider">Title</label><input type="text" value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500" /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wider">Spec / Description</label><textarea value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={6} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-y" /></div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wider">Acceptance Criteria</label>
              <textarea value={editing.acceptanceCriteria} onChange={e => setEditing({ ...editing, acceptanceCriteria: e.target.value })} rows={5} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-y" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2"><label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Images</label><button onClick={() => { const u = prompt("Image URL:"); if (u) setEditing({ ...editing, images: [...(editing.images || []), { url: u }] }); }} className="text-xs text-indigo-600 font-medium">+ Image</button></div>
              {(!editing.images || editing.images.length === 0) ? <div className="border border-dashed border-gray-300 rounded-lg p-3 text-center text-xs text-gray-400">No images</div> : <div className="flex gap-2 flex-wrap">{editing.images.map((img, i) => <div key={i} className="relative bg-gray-100 rounded-lg p-2 group"><div className="w-16 h-12 bg-gray-200 rounded flex items-center justify-center text-xs text-gray-400">🖼</div><button onClick={() => setEditing({ ...editing, images: editing.images.filter((_, j) => j !== i) })} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100">×</button></div>)}</div>}
            </div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wider">Model</label><select value={editing.model} onChange={e => setEditing({ ...editing, model: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"><option value="sonnet">Sonnet 4.5</option><option value="opus">Opus 4.6</option></select></div>
            <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
              <button onClick={() => setEditing(null)} className="px-4 py-2.5 text-sm text-gray-600">Cancel</button>
              {editing._origStatus === "queued" ? (
                <button onClick={saveEdit} disabled={!editing.title} className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white text-sm font-medium px-6 py-2.5 rounded-lg">Save Changes</button>
              ) : (
                <button onClick={saveEdit} disabled={!editing.title} className="bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 text-white text-sm font-medium px-6 py-2.5 rounded-lg">⚠️ Save & Re-queue</button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-5 max-w-3xl">
        <div className="flex items-center gap-3">
          <button onClick={() => setDetailId(null)} className="text-gray-400 hover:text-gray-600 text-sm">← Tasks</button>
          <span className="text-gray-300">/</span>
          <span className="text-sm text-gray-500">{detailTask.projectName}</span>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white font-bold text-sm">{detailTask.projectName?.[0]?.toUpperCase()}</div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{detailTask.title}</h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-400">{detailTask.projectName}</span>
                    <span className="text-xs text-gray-300">·</span>
                    <span className="text-xs text-gray-400">Created {detailTask.createdAt}</span>
                    {detailTask.reviewCycle > 0 && <><span className="text-xs text-gray-300">·</span><span className="text-xs text-pink-500">Cycle #{detailTask.reviewCycle}</span></>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-1.5 py-0.5 rounded ${detailTask.model === "opus" ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-500"}`}>{detailTask.model}</span>
                {detailTask.prNumber && <span className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded font-mono">PR #{detailTask.prNumber}</span>}
                <Badge s={detailTask.status} />
              </div>
            </div>
          </div>

          {/* Actions bar */}
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
            {isEditable && <button onClick={() => setEditing({ ...detailTask, acceptanceCriteria: (detailTask.acceptanceCriteria || []).join("\n"), _origStatus: detailTask.status })} className="text-xs bg-white border border-gray-300 hover:border-indigo-300 text-gray-700 font-medium px-3 py-1.5 rounded-lg">✏️ Edit</button>}
            {detailTask.status === "queued" && <button onClick={() => { start(detailTask); setDetailId(null); }} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1.5 rounded-lg">▶ Start</button>}
            {detailTask.status === "spec_feedback" && <>
              <button onClick={() => setEditing({ ...detailTask, acceptanceCriteria: (detailTask.acceptanceCriteria || []).join("\n"), _origStatus: "queued" })} className="text-xs bg-cyan-600 hover:bg-cyan-700 text-white font-medium px-3 py-1.5 rounded-lg">✏️ Refine Spec</button>
              <button onClick={() => { dispatch({ type: "LOG", p: { t: ts(), p: detailTask.projectName, m: `⏩ Spec accepted as-is → continues`, k: "ok" } }); onStart(detailTask, -1); setDetailId(null); }} className="text-xs bg-gray-500 hover:bg-gray-600 text-white font-medium px-3 py-1.5 rounded-lg">Continue as-is →</button>
            </>}
            {detailTask.status === "pr_feedback" && <>
              <button onClick={() => { fetchAndFix(detailTask); setDetailId(null); }} className="text-xs bg-orange-500 hover:bg-orange-600 text-white font-medium px-3 py-1.5 rounded-lg">📥 Fetch & Fix</button>
              <button onClick={() => { dispatch({ type: "UPD_TASK", p: { id: detailTask.id, status: "completed" } }); dispatch({ type: "LOG", p: { t: ts(), p: detailTask.projectName, m: `✅ PR #${detailTask.prNumber} approved`, k: "ok" } }); }} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1.5 rounded-lg">✅ Approve</button>
            </>}
            {detailTask.status === "queued" && <button onClick={() => { dispatch({ type: "DEL_TASK", id: detailTask.id }); setDetailId(null); }} className="text-xs text-red-400 hover:text-red-600 font-medium px-3 py-1.5 ml-auto">Delete</button>}
          </div>

          {/* Progress if running */}
          {!["queued", "completed", "failed", "pr_feedback", "spec_feedback"].includes(detailTask.status) && <div className="px-6 py-4 border-b border-gray-100"><ProgressBar agent={ag} /></div>}

          {/* Spec Review Suggestions */}
          {detailTask.status === "spec_feedback" && detailTask.specSuggestions?.length > 0 && (
            <div className="px-6 py-4 border-b border-gray-100 bg-cyan-50/50">
              <h4 className="text-xs font-semibold text-cyan-700 uppercase tracking-wider mb-2">📐 Agent Suggestions for the Spec</h4>
              <div className="space-y-2">
                {detailTask.specSuggestions.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 bg-white border border-cyan-200 rounded-lg p-2.5">
                    <span className="text-cyan-500 text-sm mt-0.5">→</span>
                    <span className="text-sm text-cyan-800">{s}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-cyan-600 mt-2">Click "✏️ Refine Spec" to edit, or "Continue as-is →" if the spec is sufficient.</p>
            </div>
          )}

          {/* Spec */}
          <div className="px-6 py-4 border-b border-gray-100">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Spec / Description</h4>
            {detailTask.description ? <p className="text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 rounded-lg p-3">{detailTask.description}</p> : <p className="text-xs text-gray-300 italic">No description</p>}
          </div>

          {/* Acceptance Criteria */}
          <div className="px-6 py-4 border-b border-gray-100">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Acceptance Criteria</h4>
            {detailTask.acceptanceCriteria?.length > 0 ? (
              <div className="space-y-1.5">{detailTask.acceptanceCriteria.map((c, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={`w-5 h-5 rounded flex items-center justify-center text-xs flex-shrink-0 mt-0.5 ${detailTask.status === "completed" ? "bg-emerald-100 text-emerald-600" : "bg-gray-100 text-gray-400"}`}>{detailTask.status === "completed" ? "✓" : i + 1}</span>
                  <span className="text-sm text-gray-700">{c}</span>
                </div>
              ))}</div>
            ) : <p className="text-xs text-gray-300 italic">No criteria</p>}
          </div>

          {/* Images */}
          {detailTask.images?.length > 0 && (
            <div className="px-6 py-4 border-b border-gray-100">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Reference Images</h4>
              <div className="flex gap-2 flex-wrap">{detailTask.images.map((img, i) => <div key={i} className="bg-gray-100 rounded-lg p-2"><div className="w-20 h-14 bg-gray-200 rounded flex items-center justify-center text-xs text-gray-400">🖼</div><p className="text-[10px] text-gray-400 mt-1 truncate w-20">{img.url}</p></div>)}</div>
            </div>
          )}

          {/* Skills */}
          <div className="px-6 py-4 border-b border-gray-100">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Project Skills</h4>
            <div className="flex flex-wrap gap-1">
              {CORE_SKILLS.map(s => <SkillTag key={s.id} id={s.id} locked size="xs" />)}
              {proj?.optionalSkills?.map(s => <SkillTag key={s} id={s} size="xs" />)}
            </div>
          </div>

          {/* Activity log for this task */}
          {taskLogs.length > 0 && (
            <div className="px-6 py-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Activity</h4>
              <div className="bg-gray-950 rounded-lg p-3 max-h-40 overflow-y-auto font-mono text-xs space-y-1">
                {taskLogs.map((l, i) => <div key={i} className="flex gap-3 text-gray-400"><span className="text-gray-600 flex-shrink-0">{l.t}</span><span className={l.k === "ok" ? "text-emerald-400" : l.k === "error" ? "text-red-400" : "text-gray-300"}>{l.m}</span></div>)}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── CREATE VIEW ──
  if (creating) {
    const proj = state.projects.find(p => p.id === form.projectId);
    return (
      <div className="space-y-5 max-w-2xl">
        <div className="flex items-center justify-between"><h2 className="text-xl font-bold text-gray-900">New SDD Task</h2><button onClick={() => setCreating(false)} className="text-sm text-gray-400">Cancel</button></div>
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wider">Project</label>
            <select value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">Select...</option>{state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {proj && <div className="mt-2 bg-gray-50 rounded-lg p-2.5"><p className="text-xs text-gray-400 mb-1 font-medium">Active skills:</p><div className="flex flex-wrap gap-1">{CORE_SKILLS.map(s => <SkillTag key={s.id} id={s.id} locked size="xs" />)}{proj.optionalSkills?.map(s => <SkillTag key={s} id={s} size="xs" />)}</div></div>}
          </div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wider">Title</label><input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="E.g.: Auth module with JWT + refresh tokens" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500" /></div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wider">Spec / Description</label><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={6} placeholder={"Required functionality,\nendpoints / components,\nvalidations, integrations,\ntechnical constraints..."} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-y" /></div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wider">Acceptance Criteria</label>
            <textarea value={form.acceptanceCriteria} onChange={e => setForm({ ...form, acceptanceCriteria: e.target.value })} rows={5}
              placeholder={"Unit tests with >80% coverage\nMeets project coding standards\nIA Reviewer passes without Critical/High\nResponsive (if applicable)\nIn-code documentation"}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-y" />
            <p className="text-xs text-gray-300 mt-1">One criterion per line. The agent validates them before commit.</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2"><label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Images</label><button onClick={() => { const u = prompt("Image URL:"); if (u) setForm({ ...form, images: [...form.images, { url: u }] }); }} className="text-xs text-indigo-600 font-medium">+ Image</button></div>
            {form.images.length === 0 ? <div className="border border-dashed border-gray-300 rounded-lg p-3 text-center text-xs text-gray-400">Mockups, wireframes, screenshots</div> : <div className="flex gap-2 flex-wrap">{form.images.map((img, i) => <div key={i} className="relative bg-gray-100 rounded-lg p-2 group"><div className="w-16 h-12 bg-gray-200 rounded flex items-center justify-center text-xs text-gray-400">🖼</div><button onClick={() => setForm({ ...form, images: form.images.filter((_, j) => j !== i) })} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100">×</button></div>)}</div>}
          </div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wider">Model</label><select value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"><option value="sonnet">Sonnet 4.5 — Fast</option><option value="opus">Opus 4.6 — Maximum quality</option></select></div>
          <div className="flex justify-end gap-3 pt-3 border-t border-gray-100"><button onClick={() => setCreating(false)} className="px-4 py-2.5 text-sm text-gray-600">Cancel</button><button onClick={submit} disabled={!form.projectId || !form.title} className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white text-sm font-medium px-6 py-2.5 rounded-lg">Create Task</button></div>
        </div>
      </div>
    );
  }

  // ── LIST VIEW (grouped by project) ──
  const tasksByProject = {};
  state.tasks.forEach(t => {
    const key = t.projectId || "no-project";
    if (!tasksByProject[key]) tasksByProject[key] = { name: t.projectName || "No project", tasks: [] };
    tasksByProject[key].tasks.push(t);
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><h2 className="text-xl font-bold text-gray-900">Tasks</h2><button onClick={() => setCreating(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg">+ New Task</button></div>

      {Object.keys(tasksByProject).length === 0 && <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-400"><p className="text-lg mb-1">No tasks</p></div>}

      {Object.entries(tasksByProject).map(([projId, group]) => {
        const proj = state.projects.find(p => p.id === projId);
        const activeSkills = proj?.optionalSkills?.length || 0;
        return (
          <div key={projId} className="space-y-2">
            <div className="flex items-center gap-3 px-1">
              <div className="w-7 h-7 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center text-white text-xs font-bold">{group.name[0]?.toUpperCase()}</div>
              <div>
                <h3 className="text-sm font-bold text-gray-800">{group.name}</h3>
                <p className="text-xs text-gray-400">{group.tasks.length} task{group.tasks.length !== 1 ? "s" : ""}{activeSkills > 0 ? ` · ${CORE_SKILLS.length + activeSkills} skills` : ` · ${CORE_SKILLS.length} core skills`}</p>
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="divide-y divide-gray-50">{group.tasks.map(task => { const ag = state.agents.find(a => a.tid === task.id); return (
                <div key={task.id} className="px-5 py-4 hover:bg-gray-50/30">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setDetailId(task.id)}>
                      <p className="text-sm font-semibold text-gray-800 truncate hover:text-indigo-600 transition-colors">{task.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {task.acceptanceCriteria?.length > 0 && <span className="text-xs text-gray-300">{task.acceptanceCriteria.length} criteria</span>}
                        {task.images?.length > 0 && <span className="text-xs text-gray-300">· {task.images.length} imgs</span>}
                        {task.reviewCycle > 0 && <span className="text-xs text-gray-300">· cycle #{task.reviewCycle}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${task.model === "opus" ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-500"}`}>{task.model}</span>
                      {(ag?.pr || task.prNumber) && <span className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded font-mono">PR #{ag?.pr || task.prNumber}</span>}
                      <Badge s={task.status} />
                      {task.status === "queued" && <button onClick={() => start(task)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg">▶ Start</button>}
                    </div>
                  </div>

                  {task.status === "spec_feedback" && (
                    <div className="mt-3 bg-cyan-50 border border-cyan-200 rounded-lg p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-cyan-800">📐 The spec needs refinement before execution</p>
                          {task.specSuggestions?.length > 0 && (
                            <div className="mt-2 space-y-1">{task.specSuggestions.map((s, i) => <div key={i} className="flex items-start gap-2"><span className="text-cyan-500 text-xs mt-0.5">→</span><span className="text-xs text-cyan-700">{s}</span></div>)}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                          <button onClick={() => setDetailId(task.id)} className="bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg">✏️ Refine Spec</button>
                          <button onClick={() => { dispatch({ type: "LOG", p: { t: ts(), p: task.projectName, m: `⏩ Spec accepted as-is → continues to Plan`, k: "ok" } }); onStart(task, -1); }} className="text-xs text-gray-500 hover:text-gray-700 font-medium px-3 py-1.5">Continue as-is →</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {task.status === "pr_feedback" && (
                    <div className="mt-3 bg-pink-50 border border-pink-200 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-pink-800">⏸️ Waiting for review on PR #{task.prNumber}</p>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                          <button onClick={() => fetchAndFix(task)} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg">📥 Fetch & Fix</button>
                          <button onClick={() => { dispatch({ type: "UPD_TASK", p: { id: task.id, status: "completed" } }); dispatch({ type: "LOG", p: { t: ts(), p: task.projectName, m: `✅ PR #${task.prNumber} approved`, k: "ok" } }); }} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg">✅ Approve</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {!["queued", "completed", "failed", "pr_feedback", "spec_feedback"].includes(task.status) && <div className="mt-2"><ProgressBar agent={ag} /></div>}
                </div>
              ); })}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// LOGS & SETTINGS
// ═══════════════════════════════════════════════════════════════

function LogsView({ state }) {
  return (
    <div className="space-y-5"><h2 className="text-xl font-bold text-gray-900">Logs</h2>
      <div className="bg-gray-950 rounded-xl overflow-hidden"><div className="p-4 max-h-[600px] overflow-y-auto font-mono text-xs space-y-1">{state.logs.length === 0 ? <p className="text-gray-600 text-center py-8">No activity</p> : state.logs.map((l, i) => <div key={i} className="flex gap-3 py-0.5 text-gray-400 hover:bg-gray-900/50 px-2 rounded"><span className="text-gray-600 flex-shrink-0">{l.t}</span><span className="text-indigo-400 w-28 truncate flex-shrink-0">{l.p}</span><span className={l.k === "ok" ? "text-emerald-400" : l.k === "error" ? "text-red-400" : "text-gray-300"}>{l.m}</span></div>)}</div></div>
    </div>
  );
}

function SettingsView({ state, dispatch }) {
  const s = state.settings;
  return (
    <div className="space-y-5"><h2 className="text-xl font-bold text-gray-900">Settings</h2>
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5 max-w-lg">
        <div><label className="block text-sm font-medium text-gray-700 mb-2">Max. simultaneous agents</label><input type="range" min={1} max={8} value={s.maxConcurrent} onChange={e => dispatch({ type: "SET", p: { maxConcurrent: +e.target.value } })} className="w-full accent-indigo-600" /><div className="flex justify-between text-xs text-gray-400 mt-1"><span>1</span><span className="font-bold text-indigo-600">{s.maxConcurrent}</span><span>8</span></div></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-2">Default model</label><select value={s.defaultModel} onChange={e => dispatch({ type: "SET", p: { defaultModel: e.target.value } })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"><option value="sonnet">Sonnet 4.5</option><option value="opus">Opus 4.6</option></select></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-2">Max. IA Review loops</label><input type="number" min={1} max={20} value={s.maxReviewLoops} onChange={e => dispatch({ type: "SET", p: { maxReviewLoops: +e.target.value } })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" /><p className="text-xs text-gray-400 mt-1">Maximum times the ia-reviewer can request fixes before escalating</p></div>
        <div className="pt-4 border-t border-gray-100"><h4 className="text-sm font-medium text-gray-700 mb-3">Environment</h4><div className="bg-gray-50 rounded-lg p-3 font-mono text-xs text-gray-500 space-y-1.5"><p>Runtime: <span className="text-gray-700">Claude Code CLI (Plan Max)</span></p><p>Core: <span className="text-indigo-600 font-semibold">{CORE_SKILLS.length} agnostic skills 🔒</span></p><p>Quality Gate: <span className="text-purple-600 font-semibold">ia-reviewer → loop until Ready to merge</span></p><p>CI: <span className="text-gray-700">GitHub Actions · claude-sonnet-4-6</span></p><p>Optional: <span className="text-gray-700">Platform/language skills per project</span></p></div></div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

export default function AgentHub() {
  const [state, dispatch] = useReducer(reducer, init);
  const [view, setView] = useState("dashboard");
  const sim = useSim(dispatch);

  useEffect(() => {
    [
      { id: "p1", name: "acme-theme", path: "/home/user/projects/acme/theme", repo: "acme-org/acme-theme", description: "WordPress theme for marketplace.\nStack: PHP 8.1, WordPress 6.4, WooCommerce 8+.\nConventions: WPCS, custom Gutenberg blocks, REST API endpoints.\nDomain: Events, tickets, portfolios, wallets.", optionalSkills: ["wordpress-pro", "obra/superpowers", "alirezarezvani/review"] },
      { id: "p2", name: "acme-api", path: "/home/user/projects/acme/api", repo: "acme-org/acme-api", description: "REST API.\nStack: NestJS, TypeScript, PostgreSQL, Redis.\nPatterns: CQRS, Event Sourcing, DTOs with class-validator.\nIntegrations: Stripe payments, SendGrid emails, S3 storage.", optionalSkills: ["nestjs-patterns", "stripe/best-practices", "tob/testing-handbook"] },
      { id: "p3", name: "acme-mobile", path: "/home/user/projects/acme/mobile", repo: "acme-org/acme-mobile", description: "Mobile app for iOS and Android.\nStack: Flutter 3.x, Dart, Riverpod.\nFeatures: QR scanner, push notifications, offline mode.", optionalSkills: ["flutter-skills"] },
    ].forEach(p => dispatch({ type: "ADD_PROJECT", p }));

    dispatch({ type: "ADD_TASK", p: { id: "t1", projectId: "p1", projectName: "acme-theme", title: "Custom Gutenberg blocks for portfolio", description: "Create 3 blocks: Portfolio Grid, Project Detail, Testimonial Slider with InspectorControls...", acceptanceCriteria: ["PHPUnit tests >80% coverage", "WPCS pass (wp_unslash, sanitize, esc_*)", "IA Reviewer: Ready to merge", "Responsive mobile/desktop"], images: [{ url: "mockup.png" }], model: "opus", status: "queued", createdAt: ts() } });
    dispatch({ type: "ADD_TASK", p: { id: "t2", projectId: "p2", projectName: "acme-api", title: "Auth module with JWT + refresh tokens", description: "NestJS authentication module with JWT, refresh tokens, guards...", acceptanceCriteria: ["Unit tests for guards and strategies", "E2E tests for login/refresh flow", "IA Reviewer: Ready to merge"], images: [], model: "sonnet", status: "queued", createdAt: ts() } });
  }, []);

  const counts = { tasks: state.tasks.filter(t => !["completed", "failed"].includes(t.status)).length, projects: state.projects.length };
  const views = { dashboard: <DashboardView state={state} />, tasks: <TasksView state={state} dispatch={dispatch} onStart={sim} />, projects: <ProjectsView state={state} dispatch={dispatch} />, workflow: <WorkflowView />, skills: <SkillsView state={state} dispatch={dispatch} />, logs: <LogsView state={state} />, settings: <SettingsView state={state} dispatch={dispatch} /> };

  return (
    <div className="flex h-screen bg-gray-100 text-gray-900 overflow-hidden">
      <Sidebar view={view} setView={setView} counts={counts} />
      <main className="flex-1 overflow-y-auto p-8">{views[view]}</main>
    </div>
  );
}
