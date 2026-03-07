import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { KnowledgeEntry, Project } from '../lib/types';
import * as ipc from '../lib/ipc';
import ConfirmModal from './ui/ConfirmModal';
import { IconBrain } from './ui/Icons';

interface KnowledgeViewProps {
  projects: Project[];
}

const SEVERITY_CONFIG: Record<string, { label: string; badge: string; dot: string }> = {
  critical: { label: 'CRIT', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400', dot: 'bg-red-500' },
  high: { label: 'HIGH', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400', dot: 'bg-orange-500' },
  medium: { label: 'MED', badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400', dot: 'bg-yellow-500' },
  low: { label: 'LOW', badge: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400', dot: 'bg-gray-400' },
};

const CATEGORY_OPTIONS = ['security', 'testing', 'architecture', 'standards', 'performance'];

export default function KnowledgeView({ projects }: KnowledgeViewProps) {
  const { t } = useTranslation(['knowledge', 'common']);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    projectId: '',
    category: 'standards',
    severity: 'medium',
    title: '',
    description: '',
    codeExample: '',
    antiPattern: '',
  });

  useEffect(() => {
    loadEntries();
  }, [filterProject]);

  async function loadEntries() {
    try {
      const data = await ipc.getKnowledgeEntries(filterProject || undefined);
      setEntries(data);
    } catch {
      // IPC not available
    }
  }

  async function createEntry() {
    if (!form.title || !form.description) return;
    try {
      await ipc.createKnowledgeEntry({
        projectId: form.projectId || undefined,
        category: form.category as KnowledgeEntry['category'],
        severity: form.severity as KnowledgeEntry['severity'],
        title: form.title,
        description: form.description,
        codeExample: form.codeExample || undefined,
        antiPattern: form.antiPattern || undefined,
      });
      setCreating(false);
      setForm({ projectId: '', category: 'standards', severity: 'medium', title: '', description: '', codeExample: '', antiPattern: '' });
      loadEntries();
    } catch {
      // error
    }
  }

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingEntry = pendingDeleteId ? entries.find((e) => e.id === pendingDeleteId) : null;

  async function confirmDeleteEntry() {
    if (!pendingDeleteId) return;
    try {
      await ipc.deleteKnowledgeEntry(pendingDeleteId);
      setPendingDeleteId(null);
      loadEntries();
    } catch {
      // error
    }
  }

  const filtered = entries.filter((e) => {
    if (filterCategory && e.category !== filterCategory) return false;
    return true;
  });

  const stats = {
    total: entries.length,
    applied: entries.reduce((sum, e) => sum + e.timesApplied, 0),
    autoFixable: 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">{t('header.title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('header.subtitle')}</p>
        </div>
        <button onClick={() => setCreating(!creating)} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1.5 rounded-lg">
          {t('button.manual')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">{t('filter.allCategories')}</option>
          {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">{t('filter.allProjects')}</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Create form */}
      {creating && (
        <div className="bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">{t('form.title')}</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('form.labelCategory')}</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500">
                {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('form.labelSeverity')}</label>
              <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('form.labelProject')}</label>
              <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">{t('form.projectGlobal')}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('form.labelTitle')}</label>
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('form.labelDescription')}</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-y" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('form.labelExample')}</label>
              <textarea value={form.codeExample} onChange={(e) => setForm({ ...form, codeExample: e.target.value })} rows={3} className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-y" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('form.labelAntiPattern')}</label>
              <textarea value={form.antiPattern} onChange={(e) => setForm({ ...form, antiPattern: e.target.value })} rows={3} className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-y" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="px-4 py-2 text-sm text-gray-600">{t('common:button.cancel')}</button>
            <button onClick={createEntry} disabled={!form.title || !form.description} className="bg-indigo-600 disabled:bg-gray-300 text-white text-sm font-medium px-5 py-2 rounded-lg">
              {t('common:button.save')}
            </button>
          </div>
        </div>
      )}

      {/* Entries */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-12 text-center text-gray-400">
          <p className="text-lg mb-1">{t('empty.title')}</p>
          <p className="text-sm">{t('empty.subtitle')}</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
          {filtered.map((entry) => {
            const sev = SEVERITY_CONFIG[entry.severity] || SEVERITY_CONFIG.medium;
            const proj = projects.find((p) => p.id === entry.projectId);
            const isExpanded = expandedId === entry.id;
            const hasDetails = !!(entry.codeExample || entry.antiPattern);
            return (
              <div key={entry.id}>
                {/* Compact row */}
                <div
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors ${isExpanded ? 'bg-gray-50 dark:bg-gray-750' : ''}`}
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                >
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sev.dot}`} />
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${sev.badge}`}>{sev.label}</span>
                  <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate flex-1">{entry.title}</span>
                  <span className="text-[10px] text-gray-400 flex-shrink-0">{entry.category}</span>
                  <span className="text-[10px] text-gray-300 dark:text-gray-600 flex-shrink-0">·</span>
                  <span className="text-[10px] text-gray-400 flex-shrink-0">{proj?.name || 'global'}</span>
                  {entry.timesApplied > 0 && (
                    <>
                      <span className="text-[10px] text-gray-300 dark:text-gray-600 flex-shrink-0">·</span>
                      <span className="text-[10px] text-indigo-500 dark:text-indigo-400 font-medium flex-shrink-0">{entry.timesApplied}x</span>
                    </>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setPendingDeleteId(entry.id); }}
                    className="text-[10px] text-gray-300 hover:text-red-500 flex-shrink-0 ml-1"
                  >
                    ✕
                  </button>
                </div>
                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-4 pb-3 pt-0 ml-8 space-y-2">
                    <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{entry.description}</p>
                    {hasDetails && (
                      <div className="grid grid-cols-2 gap-2">
                        {entry.antiPattern && (
                          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2.5">
                            <p className="text-[10px] font-semibold text-red-600 dark:text-red-400 mb-1">{t('detail.antiPattern')}</p>
                            <pre className="text-[10px] font-mono text-red-800 dark:text-red-300 whitespace-pre-wrap">{entry.antiPattern}</pre>
                          </div>
                        )}
                        {entry.codeExample && (
                          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2.5">
                            <p className="text-[10px] font-semibold text-green-600 dark:text-green-400 mb-1">{t('detail.correct')}</p>
                            <pre className="text-[10px] font-mono text-green-800 dark:text-green-300 whitespace-pre-wrap">{entry.codeExample}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Stats */}
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center">
        <p className="text-xs text-gray-500">
          {t('stats', { total: stats.total, applied: stats.applied, autoFixable: stats.autoFixable })}
        </p>
      </div>

      <ConfirmModal
        open={!!pendingDeleteId}
        title={t('confirm.deleteTitle')}
        message={t('confirm.deleteMessage', { title: pendingEntry?.title || '' })}
        confirmLabel={t('common:button.delete')}
        variant="danger"
        onConfirm={confirmDeleteEntry}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
