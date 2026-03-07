import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Log, Project } from '../lib/types';
import * as ipc from '../lib/ipc';
import { formatTime } from '../lib/format';

interface LogsViewProps {
  projects: Project[];
}

export default function LogsView({ projects }: LogsViewProps) {
  const { t } = useTranslation(['logs', 'common']);
  const [logs, setLogs] = useState<Log[]>([]);
  const [filterProject, setFilterProject] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadLogs();
    const interval = setInterval(loadLogs, 3000);
    return () => clearInterval(interval);
  }, [filterProject]);

  async function loadLogs() {
    try {
      const data = await ipc.getLogs(200, filterProject || undefined);
      setLogs(data);
    } catch {
      // IPC not available in dev without Electron
    }
  }

  return (
    <div className="flex flex-col h-full gap-5">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('header.title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('header.subtitle')}</p>
        </div>
        <select
          value={filterProject}
          onChange={(e) => setFilterProject(e.target.value)}
          className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">{t('common:filter.allProjects', { defaultValue: t('filter.allProjects') })}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.name}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-gray-950 rounded-xl overflow-hidden flex-1 min-h-0">
        <div ref={containerRef} className="p-4 h-full overflow-y-auto font-mono text-xs space-y-1">
          {logs.length === 0 ? (
            <p className="text-gray-600 text-center py-8">{t('empty')}</p>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="flex gap-3 py-0.5 text-gray-400 hover:bg-gray-900/50 px-2 rounded">
                <span className="text-gray-600 flex-shrink-0">
                  {formatTime(l.createdAt)}
                </span>
                <span className="text-indigo-400 w-28 truncate flex-shrink-0">{l.projectName}</span>
                <span className={l.kind === 'ok' ? 'text-emerald-400' : l.kind === 'error' ? 'text-red-400' : 'text-gray-300'}>
                  {l.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
