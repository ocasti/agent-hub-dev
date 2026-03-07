import { useTranslation } from 'react-i18next';
import type { TaskStatus } from '../../lib/types';
import { STATUS_STYLES } from '../../lib/workflow';

interface BadgeProps {
  status: TaskStatus;
}

export default function Badge({ status }: BadgeProps) {
  const { t } = useTranslation('workflow');
  const styles = STATUS_STYLES[status] || STATUS_STYLES.queued;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${styles.className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${styles.dotClass}`} />
      {t(`status.${status}`)}
    </span>
  );
}
