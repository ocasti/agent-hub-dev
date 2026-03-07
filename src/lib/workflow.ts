import type { WorkflowPhase, TaskStatus } from './types';

export const WORKFLOW_PHASES: WorkflowPhase[] = [
  { id: 'spec_analyze', label: 'workflowPhase.spec_analyze', phase: 0, skill: 'alinaqi/claude-bootstrap', icon: 'search' },
  { id: 'spec_validate', label: 'workflowPhase.spec_validate', phase: 0, skill: 'alinaqi/claude-bootstrap', icon: 'ruler' },
  { id: 'spec_ok', label: 'workflowPhase.spec_ok', phase: 0, skill: 'alinaqi/claude-bootstrap', icon: 'circle-check' },
  { id: 'plan_decompose', label: 'workflowPhase.plan_decompose', phase: 1, skill: 'ramziddin/solid-skills', icon: 'clipboard' },
  { id: 'plan_risks', label: 'workflowPhase.plan_risks', phase: 1, skill: 'ramziddin/solid-skills', icon: 'warning' },
  { id: 'plan_approval', label: 'workflowPhase.plan_approval', phase: 1, skill: 'ramziddin/solid-skills', icon: 'check' },
  { id: 'impl_code', label: 'workflowPhase.impl_code', phase: 2, skill: 'ramziddin/solid-skills', icon: 'gear' },
  { id: 'impl_tests', label: 'workflowPhase.impl_tests', phase: 2, skill: 'ramziddin/solid-skills', icon: 'flask' },
  { id: 'gate_tests', label: 'workflowPhase.gate_tests', phase: 3, skill: 'ramziddin/solid-skills', icon: 'circle-check' },
  { id: 'gate_review', label: 'workflowPhase.gate_review', phase: 3, skill: 'alirezarezvani/claude-skills', icon: 'search' },
  { id: 'gate_fix', label: 'workflowPhase.gate_fix', phase: 3, skill: 'alirezarezvani/claude-skills', icon: 'wrench' },
  { id: 'gate_recheck', label: 'workflowPhase.gate_recheck', phase: 3, skill: 'alirezarezvani/claude-skills', icon: 'refresh' },
  { id: 'gate_pass', label: 'workflowPhase.gate_pass', phase: 3, skill: 'alirezarezvani/claude-skills', icon: 'circle-dot' },
  { id: 'commit_push', label: 'workflowPhase.commit_push', phase: 4, skill: 'fvadicamo/dev-agent-skills', icon: 'upload' },
  { id: 'ci_review', label: 'workflowPhase.ci_review', phase: 4, skill: 'fvadicamo/dev-agent-skills', icon: 'robot' },
  { id: 'pr_waiting', label: 'workflowPhase.pr_waiting', phase: 5, skill: 'manual', icon: 'pause' },
  { id: 'pr_fetch', label: 'workflowPhase.pr_fetch', phase: 5, skill: 'fvadicamo/dev-agent-skills', icon: 'download' },
  { id: 'pr_fix', label: 'workflowPhase.pr_fix', phase: 5, skill: 'ramziddin/solid-skills', icon: 'wrench' },
  { id: 'pr_repush', label: 'workflowPhase.pr_repush', phase: 5, skill: 'fvadicamo/dev-agent-skills', icon: 'refresh' },
];

// Status label keys map to workflow:status.<status> in translations
export const STATUS_STYLES: Record<TaskStatus, { className: string; dotClass: string }> = {
  queued: { className: 'bg-amber-100 text-amber-800', dotClass: 'bg-amber-400' },
  spec_review: { className: 'bg-cyan-100 text-cyan-800', dotClass: 'bg-cyan-500 animate-pulse' },
  spec_feedback: { className: 'bg-cyan-100 text-cyan-800', dotClass: 'bg-cyan-400' },
  planning: { className: 'bg-sky-100 text-sky-800', dotClass: 'bg-sky-500 animate-pulse' },
  plan_review: { className: 'bg-sky-100 text-sky-800', dotClass: 'bg-sky-400' },
  implementing: { className: 'bg-blue-100 text-blue-800', dotClass: 'bg-blue-500 animate-pulse' },
  reviewing: { className: 'bg-purple-100 text-purple-800', dotClass: 'bg-purple-500 animate-pulse' },
  fixing: { className: 'bg-orange-100 text-orange-800', dotClass: 'bg-orange-500 animate-pulse' },
  shipping: { className: 'bg-teal-100 text-teal-800', dotClass: 'bg-teal-500 animate-pulse' },
  pr_feedback: { className: 'bg-pink-100 text-pink-800', dotClass: 'bg-pink-400' },
  pr_fixing: { className: 'bg-orange-100 text-orange-800', dotClass: 'bg-orange-500 animate-pulse' },
  push_review: { className: 'bg-amber-100 text-amber-800', dotClass: 'bg-amber-400' },
  test_fixing: { className: 'bg-red-100 text-red-800', dotClass: 'bg-red-500' },
  completed: { className: 'bg-emerald-100 text-emerald-800', dotClass: 'bg-emerald-500' },
  failed: { className: 'bg-red-100 text-red-800', dotClass: 'bg-red-500' },
};

export const PHASE_COLORS: Record<number, string> = {
  0: 'from-cyan-500 to-cyan-600',
  1: 'from-sky-500 to-sky-600',
  2: 'from-blue-500 to-blue-600',
  3: 'from-purple-500 to-purple-600',
  4: 'from-teal-500 to-teal-600',
  5: 'from-pink-500 to-pink-600',
};
