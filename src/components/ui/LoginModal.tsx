import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onLogin: (key: string) => void;
  loading?: boolean;
  error?: string | null;
  message?: string;
}

export default function LoginModal({ open, onClose, onLogin, loading, error, message }: LoginModalProps) {
  const { t } = useTranslation('settings');
  const [key, setKey] = useState('');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {t('license.loginTitle', 'Activate License')}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('license.loginSubtitle', 'Enter your license key to unlock Pro features.')}
          </p>
        </div>

        {message && (
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
            {message}
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
            {t('license.keyLabel', 'License Key')}
          </label>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            disabled={loading}
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <a
            href="https://agenthub.app/pricing"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {t('license.createAccount', 'Get a license key')}
          </a>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400"
              disabled={loading}
            >
              {t('license.cancel', 'Cancel')}
            </button>
            <button
              onClick={() => onLogin(key)}
              disabled={!key.trim() || loading}
              className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading && (
                <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              {t('license.activate', 'Activate')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
