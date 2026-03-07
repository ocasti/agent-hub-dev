import { findSkill } from '../../lib/skills';
import { IconLock } from './Icons';

interface SkillTagProps {
  id: string;
  locked?: boolean;
  removable?: boolean;
  onRemove?: (id: string) => void;
  size?: 'xs' | 'sm';
}

export default function SkillTag({ id, locked, removable, onRemove, size = 'sm' }: SkillTagProps) {
  const s = findSkill(id);
  const name = s?.name || id.split('/').pop() || id;
  const isCore = s?.locked || locked;

  const base = size === 'xs'
    ? 'px-1.5 py-0.5 text-[10px] leading-tight'
    : 'px-2 py-0.5 text-xs';

  const style = isCore
    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600';

  return (
    <span className={`inline-flex items-center gap-1 ${base} rounded-md font-medium ${style}`}>
      {isCore && <IconLock className="w-2.5 h-2.5" />}
      {name}
      {removable && !isCore && (
        <button onClick={() => onRemove?.(id)} className="ml-0.5 hover:text-red-500">
          x
        </button>
      )}
    </span>
  );
}
