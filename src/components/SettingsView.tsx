import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Settings, HealthStatus, LicenseLimits } from '../lib/types';
import { CORE_SKILLS } from '../lib/skills';
import * as ipc from '../lib/ipc';
import { IconSun, IconMoon, IconLock, IconTrash } from './ui/Icons';

interface SettingsViewProps {
  settings: Settings;
  onUpdate: (key: string, value: string) => void;
  licensePlan?: 'free' | 'pro';
  onOpenLogin?: () => void;
}

export default function SettingsView({ settings, onUpdate, licensePlan = 'free', onOpenLogin }: SettingsViewProps) {
  const { t } = useTranslation('settings');
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [logsCleared, setLogsCleared] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    ipc.healthCheck().then(setHealth).catch(() => {});
  }, []);

  const handleDeactivate = async () => {
    setDeactivating(true);
    try {
      await ipc.deactivateLicense();
      window.location.reload();
    } catch {
      // ignore
    } finally {
      setDeactivating(false);
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      await ipc.checkForUpdate();
    } catch {
      // ignore
    } finally {
      setTimeout(() => setCheckingUpdate(false), 2000);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('header.title')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('header.subtitle')}</p>
      </div>
      {/* Account & License */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-4">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('license.sectionTitle', 'Account & License')}
        </h4>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {licensePlan === 'pro' ? (
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
                PRO
              </span>
            ) : (
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                FREE
              </span>
            )}
            {settings.licenseEmail && (
              <span className="text-sm text-gray-600 dark:text-gray-400">{settings.licenseEmail}</span>
            )}
          </div>
          {licensePlan === 'pro' ? (
            <button
              onClick={handleDeactivate}
              disabled={deactivating}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
            >
              {deactivating ? t('license.deactivating', 'Deactivating...') : t('license.deactivate', 'Deactivate')}
            </button>
          ) : (
            <button
              onClick={onOpenLogin}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              {t('license.login', 'Activate License')}
            </button>
          )}
        </div>
      </div>

      {/* Updates */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-4">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('update.sectionTitle', 'Updates')}
        </h4>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('update.currentVersion', 'Current version')}: <span className="font-mono font-medium">{settings.licenseKey ? 'v' : ''}1.0.0</span>
            </p>
            {settings.updateLastCheck && (
              <p className="text-xs text-gray-400 mt-0.5">
                {t('update.lastChecked', 'Last checked')}: {new Date(settings.updateLastCheck).toLocaleString()}
              </p>
            )}
          </div>
          <button
            onClick={handleCheckUpdate}
            disabled={checkingUpdate}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {checkingUpdate ? t('update.checking', 'Checking...') : t('update.checkNow', 'Check Now')}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 dark:text-gray-400">
            {t('update.autoCheck', 'Auto-check for updates')}
          </label>
          <button
            onClick={() => onUpdate('update_auto_check', settings.updateAutoCheck ? 'false' : 'true')}
            className={`relative inline-flex items-center w-11 h-6 rounded-full transition-colors ${
              settings.updateAutoCheck ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span
              className={`inline-block w-4 h-4 bg-white rounded-full transition-transform shadow ${
                settings.updateAutoCheck ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-5">
        {/* Theme + Language row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('label.theme')}</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onUpdate('theme', 'light')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                  settings.theme === 'light'
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300'
                    : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400'
                }`}
              >
                <IconSun className="w-4 h-4" /> Light
              </button>
              <button
                onClick={() => onUpdate('theme', 'dark')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                  settings.theme === 'dark'
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300'
                    : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400'
                }`}
              >
                <IconMoon className="w-4 h-4" /> Dark
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('label.language')}</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onUpdate('locale', 'en')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                  settings.locale === 'en'
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300'
                    : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400'
                }`}
              >
                English
              </button>
              <button
                onClick={() => onUpdate('locale', 'es')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                  settings.locale === 'es'
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300'
                    : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400'
                }`}
              >
                Español
              </button>
            </div>
          </div>
        </div>

        {/* Max Concurrent + Default Model + Review Loops row */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('label.maxConcurrent')}</label>
            <input
              type="number"
              min={1}
              max={8}
              value={settings.maxConcurrent}
              onChange={(e) => onUpdate('max_concurrent', e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('label.defaultModel')}</label>
            <select
              value={settings.defaultModel}
              onChange={(e) => onUpdate('default_model', e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="sonnet">Sonnet 4.6</option>
              <option value="opus">Opus 4.6</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('label.maxReviewLoops')}</label>
            <input
              type="number"
              min={1}
              max={20}
              value={settings.maxReviewLoops}
              onChange={(e) => onUpdate('max_review_loops', e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-gray-400 mt-1">{t('maxReviewLoopsHelp')}</p>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{t('scopeGuard.title')}</h4>
          <p className="text-xs text-gray-400 mb-3">{t('scopeGuard.description')}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('scopeGuard.threadMaxFiles')}</label>
              <input type="number" min={1} max={50} value={settings.threadMaxFiles} onChange={(e) => onUpdate('thread_max_files', e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('scopeGuard.threadMaxLines')}</label>
              <input type="number" min={10} max={1000} value={settings.threadMaxLines} onChange={(e) => onUpdate('thread_max_lines', e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('scopeGuard.postFixLinesPerComment')}</label>
              <input type="number" min={10} max={500} value={settings.postFixLinesPerComment} onChange={(e) => onUpdate('postfix_lines_per_comment', e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('scopeGuard.postFixFilesPerComment')}</label>
              <input type="number" min={1} max={20} value={settings.postFixFilesPerComment} onChange={(e) => onUpdate('postfix_files_per_comment', e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('scopeGuard.testTimeoutMin')}</label>
              <input type="number" min={1} max={30} value={settings.testTimeoutMin} onChange={(e) => onUpdate('test_timeout_min', e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
              <p className="text-xs text-gray-400 mt-1">{t('scopeGuard.testTimeoutHelp')}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('scopeGuard.testFixRetries')}</label>
              <input type="number" min={1} max={10} value={settings.testFixRetries} onChange={(e) => onUpdate('test_fix_retries', e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
              <p className="text-xs text-gray-400 mt-1">{t('scopeGuard.testFixRetriesHelp')}</p>
            </div>
          </div>
        </div>

        {health && (
          <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{t('healthCheck.title')}</h4>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${health.claudeInstalled ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className="text-sm text-gray-600 dark:text-gray-400">Claude Code CLI</span>
                {health.claudeVersion && <span className="text-xs text-gray-400">{health.claudeVersion}</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${health.ghInstalled ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className="text-sm text-gray-600 dark:text-gray-400">GitHub CLI</span>
                {health.ghVersion && <span className="text-xs text-gray-400">{health.ghVersion}</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${health.gitInstalled ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className="text-sm text-gray-600 dark:text-gray-400">Git</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${health.specifyInstalled ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className="text-sm text-gray-600 dark:text-gray-400">{t('healthCheck.specKit')}</span>
                {!health.specifyInstalled && <span className="text-xs text-red-500">{t('healthCheck.specKitRequired')}</span>}
              </div>
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{t('data.title')}</h4>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t('data.clearLogs')}</p>
              <p className="text-xs text-gray-400 mt-0.5">{t('data.clearLogsDesc')}</p>
            </div>
            <button
              onClick={async () => {
                try {
                  await ipc.clearLogs();
                  setLogsCleared(true);
                  setTimeout(() => setLogsCleared(false), 2000);
                } catch { /* error */ }
              }}
              className="flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <IconTrash className="w-3.5 h-3.5" />
              {logsCleared ? t('data.cleared') : t('data.clearButton')}
            </button>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{t('env.title')}</h4>
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 font-mono text-xs text-gray-500 space-y-1.5">
            <p>{t('env.runtime')} <span className="text-gray-700 dark:text-gray-300">{t('env.runtimeValue')}</span></p>
            <p>{t('env.core')} <span className="text-indigo-600 dark:text-indigo-400 font-semibold inline-flex items-center gap-1">{t('env.coreValue', { count: CORE_SKILLS.length })} <IconLock className="w-3 h-3" /></span></p>
            <p>{t('env.qualityGate')} <span className="text-purple-600 dark:text-purple-400 font-semibold">{t('env.qualityGateValue')}</span></p>
            <p>{t('env.ci')} <span className="text-gray-700 dark:text-gray-300">{t('env.ciValue')}</span></p>
            <p>{t('env.optional')} <span className="text-gray-700 dark:text-gray-300">{t('env.optionalValue')}</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}
