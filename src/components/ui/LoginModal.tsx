import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type AuthMode = 'login' | 'register';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onLogin: (username: string, password: string) => void;
  onRegister: (username: string, email: string, password: string) => void;
  loading?: boolean;
  error?: string | null;
  message?: string;
}

export default function LoginModal({ open, onClose, onLogin, onRegister, loading, error, message }: LoginModalProps) {
  const { t } = useTranslation('settings');
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  if (!open) return null;

  const canSubmitLogin = username.trim() && password.trim();
  const canSubmitRegister = username.trim() && email.trim() && password.trim() && password === confirmPassword && password.length >= 8;

  const handleSubmit = () => {
    if (mode === 'login') {
      onLogin(username, password);
    } else {
      onRegister(username, email, password);
    }
  };

  const switchMode = (newMode: AuthMode) => {
    setMode(newMode);
    setUsername('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {mode === 'login'
              ? t('auth.loginTitle', 'Sign In')
              : t('auth.registerTitle', 'Create Account')}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {mode === 'login'
              ? t('auth.loginSubtitle', 'Sign in to unlock more projects and concurrent agents.')
              : t('auth.registerSubtitle', 'Free account: 5 projects and 2 concurrent agents.')}
          </p>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => switchMode('login')}
            className={`flex-1 pb-2 text-sm font-medium border-b-2 transition-colors ${
              mode === 'login'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {t('auth.tabLogin', 'Sign In')}
          </button>
          <button
            onClick={() => switchMode('register')}
            className={`flex-1 pb-2 text-sm font-medium border-b-2 transition-colors ${
              mode === 'register'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {t('auth.tabRegister', 'Create Account')}
          </button>
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

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
              {t('auth.usernameLabel', 'Username')}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('auth.usernamePlaceholder', 'your_username')}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={loading}
              autoFocus
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
                {t('auth.emailLabel', 'Email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder', 'you@example.com')}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                disabled={loading}
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
              {t('auth.passwordLabel', 'Password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && mode === 'login' && canSubmitLogin) handleSubmit();
              }}
            />
            {mode === 'register' && password.length > 0 && password.length < 8 && (
              <p className="text-xs text-amber-500 mt-1">{t('auth.passwordMin', 'Minimum 8 characters')}</p>
            )}
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
                {t('auth.confirmPasswordLabel', 'Confirm Password')}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                disabled={loading}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSubmitRegister) handleSubmit();
                }}
              />
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-red-500 mt-1">{t('auth.passwordMismatch', 'Passwords do not match')}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end pt-2">
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400"
              disabled={loading}
            >
              {t('auth.cancel', 'Cancel')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={mode === 'login' ? !canSubmitLogin || loading : !canSubmitRegister || loading}
              className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading && (
                <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              {mode === 'login'
                ? t('auth.signIn', 'Sign In')
                : t('auth.createAccount', 'Create Account')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
