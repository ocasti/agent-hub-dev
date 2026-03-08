import { useTranslation } from 'react-i18next';
import { IconRefresh, IconPause, IconSearch, IconCircleCheck, IconGear, IconClipboard } from './ui/Icons';
import { useState, useRef, type ReactNode } from 'react';

// ── Diagram helpers ──────────────────────────────────────────────

function NumBadge({ num, color }: { num: number; color: string }) {
  return (
    <span className={`w-6 h-6 ${color} text-white rounded-md flex items-center justify-center text-[11px] font-bold shrink-0`}>
      {num}
    </span>
  );
}

function VLine({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center py-0.5">
      <div className="w-0.5 h-4 bg-gray-300 dark:bg-gray-600" />
      <svg width="10" height="7" className="text-gray-300 dark:text-gray-600" fill="currentColor">
        <polygon points="5,7 0,0 10,0" />
      </svg>
      {label && <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium mt-0.5">{label}</span>}
    </div>
  );
}

function HLine() {
  return (
    <div className="flex items-center">
      <div className="h-0.5 w-5 bg-gray-300 dark:bg-gray-600" />
      <svg width="7" height="10" className="text-gray-300 dark:text-gray-600 -ml-px" fill="currentColor">
        <polygon points="7,5 0,0 0,10" />
      </svg>
    </div>
  );
}

function LoopSvg({ className }: { className?: string }) {
  return (
    <svg width="24" height="32" viewBox="0 0 24 32" fill="none" className={className}>
      <path d="M0 24 L10 24 C20 24, 20 8, 10 8 L4 8" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
      <polygon points="6,5.5 2,8 6,10.5" fill="currentColor" />
    </svg>
  );
}

// ── Tooltip ──────────────────────────────────────────────────────

function DiagramTooltip({ children, content }: { children: ReactNode; content: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setAbove(window.innerHeight - rect.bottom < 340);
    }
    setOpen(true);
  };

  return (
    <div ref={ref} className="relative cursor-default" onMouseEnter={handleEnter} onMouseLeave={() => setOpen(false)}>
      {children}
      {open && (
        <div className={`absolute left-1/2 -translate-x-1/2 z-30 ${above ? 'bottom-full pb-1.5' : 'top-full pt-1.5'}`}>
          <div className="relative bg-gray-900 dark:bg-gray-700 text-gray-200 rounded-lg p-3.5 shadow-xl text-xs w-80 max-h-80 overflow-y-auto">
            <div className={`absolute left-1/2 -translate-x-1/2 w-3 h-3 bg-gray-900 dark:bg-gray-700 rotate-45 ${above ? '-bottom-1.5' : '-top-1.5'}`} />
            <div className="relative">{content}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function PhaseTooltip({ idx, extra }: { idx: number; extra?: ReactNode }) {
  const { t } = useTranslation('workflow');

  const phaseKeys = ['spec', 'plan', 'impl', 'gate', 'ship', 'pr'];
  const phaseTitles = [
    t('phaseTitle.specReview'), t('phaseTitle.plan'), t('phaseTitle.implement'),
    t('phaseTitle.qualityGate'), t('phaseTitle.ship'), t('phaseTitle.prFeedback'),
  ];
  const skills = [
    'alinaqi/claude-bootstrap', 'ramziddin/solid-skills', 'ramziddin/solid-skills',
    'alirezarezvani/claude-skills', 'fvadicamo/dev-agent-skills', 'manual → agente',
  ];
  const stepCounts = [6, 5, 5, 5, 2, 8];

  const key = phaseKeys[idx];
  const steps = Array.from({ length: stepCounts[idx] }, (_, i) => t(`steps.${key}.${i}`));

  return (
    <>
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-semibold text-white">Phase {idx} — {phaseTitles[idx]}</span>
        <span className="text-[10px] text-gray-400 font-mono ml-2">{skills[idx]}</span>
      </div>
      {idx === 0 && <p className="text-cyan-400 text-[10px] mb-1.5 flex items-center gap-1"><IconSearch className="w-3 h-3" /> {t('tooltip.specConditional')}</p>}
      {idx === 3 && <p className="text-purple-400 text-[10px] mb-1.5 flex items-center gap-1"><IconRefresh className="w-3 h-3" /> {t('tooltip.gateLoop')}</p>}
      {idx === 5 && <p className="text-pink-400 text-[10px] mb-1.5 flex items-center gap-1"><IconPause className="w-3 h-3" /> {t('tooltip.prManual')}</p>}
      <div className="space-y-0.5 text-gray-300">
        {steps.map((s, i) => (
          <div key={i} className="flex gap-1.5">
            <span className="text-gray-500 shrink-0">{i + 1}.</span>
            <span>{s}</span>
          </div>
        ))}
      </div>
      {extra && <div className="mt-2.5 pt-2.5 border-t border-gray-600">{extra}</div>}
    </>
  );
}

function HookBadge({ hookKey }: { hookKey: string }) {
  const { t } = useTranslation('workflow');
  return (
    <div className="text-[9px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 rounded px-1 py-0.5 mt-0.5 max-w-[320px] text-center leading-relaxed">
      <span className="text-gray-400 dark:text-gray-500">{t('hooks.label')}</span>{' '}
      {t(hookKey)}
    </div>
  );
}

// ── WorkflowDiagram ──────────────────────────────────────────────

function WorkflowDiagram() {
  const { t } = useTranslation('workflow');

  return (
    <div className="mt-4">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-y-1 items-center justify-items-center min-w-[520px]">
        {/* ─── Tarea en Cola ─── */}
        <div />
        <DiagramTooltip content={
          <>
            <p className="font-semibold text-white mb-1.5">{t('diagram.taskQueued')}</p>
            <p className="text-gray-300">{t('diagram.taskQueuedTooltip')}</p>
          </>
        }>
          <div className="inline-flex items-center gap-2 bg-amber-500 text-white rounded-xl px-5 py-2 font-semibold text-sm shadow-sm">
            <IconClipboard className="w-4 h-4" />
            {t('diagram.taskQueued')}
          </div>
        </DiagramTooltip>
        <div />

        <div /><VLine /><div />

        {/* ─── Phase 0: Spec Review ─── */}
        <div />
        <DiagramTooltip content={<PhaseTooltip idx={0} />}>
          <div className="inline-flex items-center gap-2.5 border-2 border-cyan-300 dark:border-cyan-700 bg-cyan-50 dark:bg-cyan-900/20 rounded-xl px-4 py-2.5">
            <NumBadge num={0} color="bg-cyan-500" />
            <div>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-200 leading-tight">{t('phaseTitle.specReview')}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('diagram.specAnalyze')}</p>
            </div>
          </div>
        </DiagramTooltip>
        <div className="justify-self-start flex items-center gap-2 pl-3">
          <HLine />
          <div className="inline-flex items-center gap-1.5 border-2 border-dashed border-cyan-300 dark:border-cyan-700 bg-cyan-50/50 dark:bg-cyan-900/10 rounded-lg px-2.5 py-1.5 text-cyan-700 dark:text-cyan-300">
            <IconPause className="w-3 h-3 opacity-70" />
            <span className="text-xs font-semibold">{t('diagram.specFeedback')}</span>
          </div>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">↩ {t('diagram.specFeedbackAction')}</span>
        </div>

        <div /><div className="flex justify-center"><HookBadge hookKey="hooks.phase0" /></div><div />
        <div /><VLine label={t('diagram.ok')} /><div />

        {/* ─── Phase 1: Plan ─── */}
        <div />
        <DiagramTooltip content={<PhaseTooltip idx={1} />}>
          <div className="inline-flex items-center gap-2.5 border-2 border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/20 rounded-xl px-4 py-2.5">
            <NumBadge num={1} color="bg-sky-500" />
            <div>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-200 leading-tight">{t('phaseTitle.plan')}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('diagram.planDecompose')}</p>
            </div>
          </div>
        </DiagramTooltip>
        <div className="justify-self-start flex items-center gap-2 pl-3">
          <HLine />
          <div className="inline-flex items-center gap-1.5 border-2 border-dashed border-sky-300 dark:border-sky-700 bg-sky-50/50 dark:bg-sky-900/10 rounded-lg px-2.5 py-1.5 text-sky-700 dark:text-sky-300">
            <IconPause className="w-3 h-3 opacity-70" />
            <span className="text-xs font-semibold">{t('diagram.planReview')}</span>
          </div>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">↩ {t('diagram.planReviewAction')}</span>
        </div>

        <div /><div className="flex justify-center"><HookBadge hookKey="hooks.phase1" /></div><div />
        <div /><VLine label={t('diagram.approves')} /><div />

        {/* ─── Git Prepare ─── */}
        <div />
        <DiagramTooltip content={
          <>
            <p className="font-semibold text-white mb-1.5">{t('tooltip.gitPrepareTitle')}</p>
            <div className="space-y-0.5 text-gray-300 mb-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex gap-1.5"><span className="text-gray-500 shrink-0">{i + 1}.</span><span>{t(`tooltip.gitPrepareSteps.${i}`)}</span></div>
              ))}
            </div>
            <div className="pt-2 border-t border-gray-600 text-gray-400 space-y-0.5">
              <p>{t('tooltip.gitPrepareNote1')}</p>
              <p>{t('tooltip.gitPrepareNote2')}</p>
            </div>
          </>
        }>
          <div className="inline-flex items-center gap-2 border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30 rounded-xl px-4 py-2">
            <IconGear className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 leading-tight">{t('diagram.gitPrepare')}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">{t('diagram.gitPrepareDesc')}</p>
            </div>
          </div>
        </DiagramTooltip>
        <div />

        <div /><VLine /><div />

        {/* ─── Phase 2: Implement ─── */}
        <div />
        <DiagramTooltip content={<PhaseTooltip idx={2} />}>
          <div className="inline-flex items-center gap-2.5 border-2 border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 rounded-xl px-4 py-2.5">
            <NumBadge num={2} color="bg-blue-500" />
            <div>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-200 leading-tight">{t('phaseTitle.implement')}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('diagram.implementDesc')}</p>
            </div>
          </div>
        </DiagramTooltip>
        <div />

        <div /><div className="flex justify-center"><HookBadge hookKey="hooks.phase2" /></div><div />
        <div /><VLine /><div />

        {/* ─── Phase 3: Quality Gate ─── */}
        <div />
        <DiagramTooltip content={
          <PhaseTooltip idx={3} extra={
            <>
              <p className="text-[10px] text-gray-400 mb-1.5 font-semibold">{t('tooltip.iaReviewPipeline')}</p>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {[
                  { l: 'Security', s: 'CRITICAL', c: 'text-red-300 bg-red-900/40' },
                  { l: 'Standards', s: 'HIGH', c: 'text-orange-300 bg-orange-900/40' },
                  { l: 'Validation', s: 'MEDIUM', c: 'text-yellow-300 bg-yellow-900/40' },
                  { l: 'Testing', s: 'MEDIUM', c: 'text-blue-300 bg-blue-900/40' },
                  { l: 'Architecture', s: 'LOW', c: 'text-gray-300 bg-gray-700' },
                ].map(c => (
                  <span key={c.l} className={`${c.c} px-1.5 py-0.5 rounded text-[10px]`}>{c.l} <span className="opacity-60">({c.s})</span></span>
                ))}
              </div>
              <p className="text-[10px] text-gray-400">{t('tooltip.patternsKnowledge')}</p>
            </>
          } />
        }>
          <div className="inline-flex items-center gap-2.5 border-2 border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20 rounded-xl px-4 py-2.5">
            <NumBadge num={3} color="bg-purple-500" />
            <div>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-200 leading-tight">{t('phaseTitle.qualityGate')}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('diagram.qualityGateDesc')}</p>
            </div>
          </div>
        </DiagramTooltip>
        <div className="justify-self-start flex items-center gap-2 pl-3">
          <LoopSvg className="text-purple-400 dark:text-purple-500" />
          <div className="text-[11px] leading-tight">
            <p className="text-purple-600 dark:text-purple-400 font-medium">{t('diagram.qualityGateLoop')}</p>
            <p className="text-gray-400 dark:text-gray-500">{t('diagram.qualityGateLoopDesc')}</p>
          </div>
        </div>

        <div /><div className="flex justify-center"><HookBadge hookKey="hooks.phase3" /></div><div />
        <div /><VLine label={`✓ ${t('diagram.ready')}`} /><div />

        {/* ─── Phase 4: Ship ─── */}
        <div />
        <DiagramTooltip content={<PhaseTooltip idx={4} />}>
          <div className="inline-flex items-center gap-2.5 border-2 border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-900/20 rounded-xl px-4 py-2.5">
            <NumBadge num={4} color="bg-teal-500" />
            <div>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-200 leading-tight">{t('phaseTitle.ship')}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('diagram.shipDesc')}</p>
            </div>
          </div>
        </DiagramTooltip>
        <div />

        <div /><div className="flex justify-center"><HookBadge hookKey="hooks.phase4" /></div><div />
        <div /><VLine /><div />

        {/* ─── PR Review (pause) ─── */}
        <div />
        <DiagramTooltip content={
          <PhaseTooltip idx={5} extra={
            <>
              <p className="text-[10px] text-gray-400 mb-1 font-semibold">{t('tooltip.fetchFixTitle')}</p>
              <div className="space-y-0.5 text-gray-300">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <p key={i}>{i + 1}. {t(`tooltip.fetchFixSteps.${i}`)}</p>
                ))}
              </div>
            </>
          } />
        }>
          <div className="inline-flex items-center gap-2.5 border-2 border-dashed border-pink-300 dark:border-pink-700 bg-pink-50 dark:bg-pink-900/20 rounded-xl px-4 py-2.5">
            <IconPause className="w-4 h-4 text-pink-500 dark:text-pink-400" />
            <div>
              <p className="text-sm font-semibold text-pink-700 dark:text-pink-300 leading-tight">{t('diagram.prReview')}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('diagram.prReviewDesc')}</p>
            </div>
          </div>
        </DiagramTooltip>
        <div className="justify-self-start flex items-center gap-2 pl-3">
          <LoopSvg className="text-pink-400 dark:text-pink-500" />
          <div className="text-[11px] leading-tight">
            <p className="text-pink-600 dark:text-pink-400 font-medium">{t('diagram.fetchAndFix')}</p>
            <p className="text-gray-400 dark:text-gray-500">{t('diagram.fetchAndFixDesc')}</p>
          </div>
        </div>

        <div /><div className="flex justify-center"><HookBadge hookKey="hooks.phase5" /></div><div />
        <div /><VLine label={t('diagram.approve')} /><div />

        {/* ─── Completada ─── */}
        <div />
        <DiagramTooltip content={
          <>
            <p className="font-semibold text-white mb-1.5">{t('tooltip.completedTitle')}</p>
            <p className="text-gray-300 mb-2">{t('diagram.completedTooltip')}</p>
            <div className="space-y-0.5 text-gray-300 text-[10px]">
              {[0, 1, 2].map((i) => (
                <p key={i}>▸ {t(`tooltip.completedNotes.${i}`)}</p>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-gray-600 text-[10px]">
              <span className="text-red-400">security</span>
              <span className="text-orange-400">standards</span>
              <span className="text-blue-400">testing</span>
              <span className="text-purple-400">architecture</span>
              <span className="text-teal-400">performance</span>
            </div>
          </>
        }>
          <div className="inline-flex items-center gap-2 bg-emerald-500 text-white rounded-xl px-5 py-2 font-semibold text-sm shadow-sm">
            <IconCircleCheck className="w-4 h-4" />
            {t('diagram.completed')}
          </div>
        </DiagramTooltip>
        <div />
      </div>
    </div>
  );
}

export default function WorkflowView() {
  const { t } = useTranslation('workflow');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Workflow SDD</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('diagram.taskQueuedTooltip').split('.')[0]}.</p>
      </div>

      <WorkflowDiagram />

      {/* Plugin info */}
      <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <h3 className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2">
          {t('pluginPhases', 'Plugin Phases')}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t('pluginPhasesDesc', 'Phases 0-3 (Spec Review through Quality Gate) are core and always run. Phases 4-5 (Ship + PR Feedback) require a code-hosting plugin (e.g. GitHub). Without a code-hosting plugin, the workflow completes at Phase 3 and git/PR is handled manually.')}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {t('pluginPhasesHint', 'Activate plugins per-project in Project Settings > Code Hosting.')}
        </p>
      </div>
    </div>
  );
}
