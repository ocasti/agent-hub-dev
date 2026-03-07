import { useTranslation } from 'react-i18next';
import type { ActiveAgent } from '../../lib/types';
import type { ReactNode } from 'react';
import { PHASE_COLORS } from '../../lib/workflow';
import {
  IconSearch, IconRuler, IconCircleCheck, IconClipboard, IconWarning, IconCheck,
  IconGear, IconFlask, IconWrench, IconRefresh, IconCircleDot, IconUpload,
  IconRobot, IconPause, IconDownload,
} from './Icons';

const ICON_MAP: Record<string, ReactNode> = {
  search: <IconSearch className="w-3.5 h-3.5" />,
  ruler: <IconRuler className="w-3.5 h-3.5" />,
  'circle-check': <IconCircleCheck className="w-3.5 h-3.5" />,
  clipboard: <IconClipboard className="w-3.5 h-3.5" />,
  warning: <IconWarning className="w-3.5 h-3.5" />,
  check: <IconCheck className="w-3.5 h-3.5" />,
  gear: <IconGear className="w-3.5 h-3.5" />,
  flask: <IconFlask className="w-3.5 h-3.5" />,
  wrench: <IconWrench className="w-3.5 h-3.5" />,
  refresh: <IconRefresh className="w-3.5 h-3.5" />,
  'circle-dot': <IconCircleDot className="w-3.5 h-3.5" />,
  upload: <IconUpload className="w-3.5 h-3.5" />,
  robot: <IconRobot className="w-3.5 h-3.5" />,
  pause: <IconPause className="w-3.5 h-3.5" />,
  download: <IconDownload className="w-3.5 h-3.5" />,
};

interface ProgressBarProps {
  agent: ActiveAgent | undefined;
}

export default function ProgressBar({ agent }: ProgressBarProps) {
  const { t } = useTranslation('workflow');

  if (!agent) return null;

  // Use currentPhase if available, otherwise fall back to phaseIdx
  const phaseNum = agent.currentPhase?.phase ?? agent.phaseIdx ?? 0;
  const colors = PHASE_COLORS[phaseNum] || PHASE_COLORS[0];
  const phaseLabel = t(`phase.${phaseNum}`);

  const phaseColorClass =
    phaseNum === 0 ? 'bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400' :
    phaseNum === 1 ? 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400' :
    phaseNum === 2 ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' :
    phaseNum === 3 ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' :
    phaseNum === 5 ? 'bg-pink-50 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400' :
    'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400';

  const ph = agent.currentPhase;
  const sub = agent.subProgress;

  // When sub-progress is available, use it to drive the bar instead of phase-level progress
  const barPercent = sub && sub.total > 0
    ? Math.round((sub.current / sub.total) * 100)
    : agent.progress;

  return (
    <div className="space-y-1.5">
      <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${colors} rounded-full transition-all duration-700`}
          style={{ width: `${barPercent}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">{ph?.icon ? ICON_MAP[ph.icon] : null}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{ph?.label ? t(ph.label) : null}</span>
        </div>
        <div className="flex items-center gap-2">
          {sub && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate max-w-[180px]">
                {sub.current}/{sub.total} · {sub.label}
              </span>
              {sub.step && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">
                  {sub.step}
                </span>
              )}
            </div>
          )}
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${phaseColorClass}`}>
            {phaseLabel}
            {phaseNum === 3 && agent.reviewLoop > 0 && (
              <span className="ml-1 opacity-75">· {t('progress.loop', { loop: agent.reviewLoop })}</span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
