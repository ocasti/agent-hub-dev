import { useTranslation } from 'react-i18next';

interface UpgradePromptProps {
  feature: string;
  currentUsage?: number;
  limit?: number;
  onLogin: () => void;
  compact?: boolean;
}

export default function UpgradePrompt({ feature, currentUsage, limit, onLogin, compact }: UpgradePromptProps) {
  const { t } = useTranslation('settings');

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
        <span className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
        {limit !== undefined && currentUsage !== undefined
          ? t('license.limitReachedCompact', { current: currentUsage, max: limit, defaultValue: `${currentUsage}/${limit}` })
          : t('license.proRequired', 'Pro')
        }
        <button onClick={onLogin} className="underline font-medium">
          {t('license.upgrade', 'Upgrade')}
        </button>
      </span>
    );
  }

  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/40 rounded-lg flex items-center justify-center text-amber-600 dark:text-amber-400 text-sm flex-shrink-0">
          PRO
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            {t('license.limitReachedTitle', { feature, defaultValue: `${feature} limit reached` })}
          </p>
          {limit !== undefined && currentUsage !== undefined && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              {t('license.limitReachedDetail', {
                current: currentUsage,
                max: limit,
                defaultValue: `Using ${currentUsage} of ${limit} available on the free plan.`,
              })}
            </p>
          )}
          <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
            {t('license.upgradeHint', 'Sign in or upgrade for more access.')}
          </p>
          <button
            onClick={onLogin}
            className="mt-2 text-xs font-medium px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-700 hover:to-purple-700"
          >
            {t('license.upgradeButton', 'Sign In / Upgrade')}
          </button>
        </div>
      </div>
    </div>
  );
}
