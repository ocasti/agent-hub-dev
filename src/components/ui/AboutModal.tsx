import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AboutModal({ open, onClose }: AboutModalProps) {
  const { t } = useTranslation('common');

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-xs mx-4 overflow-hidden">
        <div className="flex flex-col items-center px-8 pt-8 pb-6 text-center">
          <img src="./icon.png" alt="Agent Hub" className="w-20 h-20 rounded-2xl shadow-lg mb-4" />
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Agent Hub</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('about.version')}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 leading-relaxed">
            {t('about.description')}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-4">
            {t('about.copyright')}
          </p>
        </div>
        <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/30 border-t border-gray-200 dark:border-gray-700 flex justify-center">
          <button
            onClick={onClose}
            autoFocus
            className="text-xs font-medium px-6 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            {t('button.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
