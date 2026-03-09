import { useTranslation } from 'react-i18next';
import type { TierName } from '../lib/types';
import * as ipc from '../lib/ipc';

export type ViewId = 'dashboard' | 'tasks' | 'projects' | 'workflow' | 'plugins' | 'skills' | 'knowledge' | 'logs' | 'settings';

interface SidebarProps {
  view: ViewId;
  setView: (v: ViewId) => void;
  counts: { tasks: number; projects: number };
  licensePlan?: TierName;
  userName?: string;
  onUpgrade?: () => void;
}

const itemDefs: { id: ViewId; labelKey: string; icon: string; countKey?: 'tasks' | 'projects' }[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: '◉' },
  { id: 'tasks', labelKey: 'nav.tasks', icon: '☰', countKey: 'tasks' },
  { id: 'projects', labelKey: 'nav.projects', icon: '◫', countKey: 'projects' },
  { id: 'workflow', labelKey: 'nav.workflow', icon: '⟳' },
  { id: 'plugins', labelKey: 'nav.plugins', icon: '⧉' },
  { id: 'skills', labelKey: 'nav.skills', icon: '⬡' },
  { id: 'knowledge', labelKey: 'nav.knowledge', icon: '◈' },
  { id: 'logs', labelKey: 'nav.logs', icon: '❯_' },
  { id: 'settings', labelKey: 'nav.settings', icon: '⚙' },
];

export default function Sidebar({ view, setView, counts, licensePlan = 'free', userName, onUpgrade }: SidebarProps) {
  const { t } = useTranslation('common');

  const isLoggedIn = licensePlan !== 'free' && !!userName;

  return (
    <div className="w-56 bg-gray-950 text-gray-300 flex flex-col flex-shrink-0">
      {/* macOS traffic light spacer + drag region */}
      <div className="h-8 flex-shrink-0 titlebar-drag" />

      <div className="px-5 pb-4 border-b border-gray-800 titlebar-drag">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center text-white text-sm font-bold">
            A
          </div>
          <div>
            <h1 className="text-white text-sm font-bold">Agent Hub</h1>
            <p className="text-gray-500 text-xs">{t('sidebar.subtitle')}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {itemDefs.map((item) => {
          const count = item.countKey ? counts[item.countKey] : 0;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all titlebar-no-drag ${
                view === item.id
                  ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                  : 'hover:bg-gray-800/60 text-gray-400'
              }`}
            >
              <span className="w-5 text-center opacity-70">{item.icon}</span>
              <span className="flex-1 text-left">{t(item.labelKey)}</span>
              {count > 0 && (
                <span className="bg-gray-800 text-gray-400 text-xs px-1.5 py-0.5 rounded-md">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-800">
        {isLoggedIn ? (
          <>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-indigo-600/30 flex items-center justify-center text-[10px] font-bold text-indigo-300">
                {userName.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs text-gray-300 font-medium truncate flex-1">{userName}</span>
              {licensePlan === 'premium' ? (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
                  PRO
                </span>
              ) : (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-700 text-emerald-200">
                  REG
                </span>
              )}
            </div>
            {licensePlan === 'registered' && onUpgrade && (
              <button onClick={onUpgrade} className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium mt-1.5">
                {t('sidebar.upgrade', 'Upgrade')}
              </button>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-700 text-gray-400">
              FREE
            </span>
            <button
              onClick={() => onUpgrade ? onUpgrade() : setView('settings')}
              className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium"
            >
              {t('sidebar.signIn', 'Sign In')}
            </button>
          </div>
        )}
        <button
          onClick={() => ipc.openExternal('https://github.com/ocasti/agent-hub-dev/blob/main/LICENSE')}
          className="block w-full text-center text-[10px] text-gray-600 hover:text-gray-400 mt-2 transition-colors"
        >
          Agent Hub — MIT License
        </button>
      </div>
    </div>
  );
}
