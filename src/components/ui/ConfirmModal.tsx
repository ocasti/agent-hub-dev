import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconTrash, IconWarning, IconInfo } from './Icons';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

const variantStyles: Record<string, { icon: ReactNode; button: string; border: string; bg: string }> = {
  danger: {
    icon: <IconTrash className="w-5 h-5" />,
    button: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    border: 'border-red-200 dark:border-red-800',
    bg: 'bg-red-50 dark:bg-red-900/20',
  },
  warning: {
    icon: <IconWarning className="w-5 h-5" />,
    button: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500',
    border: 'border-amber-200 dark:border-amber-800',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
  },
  info: {
    icon: <IconInfo className="w-5 h-5" />,
    button: 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500',
    border: 'border-indigo-200 dark:border-indigo-800',
    bg: 'bg-indigo-50 dark:bg-indigo-900/20',
  },
};

export default function ConfirmModal({
  open, title, message, confirmLabel, cancelLabel,
  variant = 'danger', onConfirm, onCancel,
}: ConfirmModalProps) {
  const { t } = useTranslation('common');
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  const s = variantStyles[variant];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      {/* Modal */}
      <div className={`relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl border ${s.border} w-full max-w-md mx-4 overflow-hidden`}>
        <div className={`px-6 py-4 ${s.bg} border-b ${s.border}`}>
          <div className="flex items-center gap-3">
            <span className="flex-shrink-0">{s.icon}</span>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
          </div>
        </div>
        <div className="px-6 py-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{message}</p>
        </div>
        <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/30 flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="text-xs font-medium px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {cancelLabel || t('confirm.defaultCancel')}
          </button>
          <button
            onClick={onConfirm}
            className={`text-xs font-medium px-4 py-2 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-offset-2 ${s.button}`}
          >
            {confirmLabel || t('confirm.defaultConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
