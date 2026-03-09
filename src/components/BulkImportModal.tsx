import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project, PmWorkItem } from '../lib/types';
import * as ipc from '../lib/ipc';

interface BulkImportModalProps {
  projects: Project[];
  existingPmIds: Set<string>;
  onImport: (projectId: string, items: ImportItem[]) => void;
  onClose: () => void;
}

export interface ImportItem {
  pmWorkItemId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
}

type Step = 'select' | 'pick';

export default function BulkImportModal({ projects, existingPmIds, onImport, onClose }: BulkImportModalProps) {
  const { t } = useTranslation(['tasks']);

  // Step 1 state
  const [step, setStep] = useState<Step>('select');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [pluginId, setPluginId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2 state
  const [items, setItems] = useState<PmWorkItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);

  // Only projects that have a PM plugin active
  const pmProjects = useMemo(
    () => projects.filter((p) => p.pluginPm),
    [projects]
  );

  // Load PM items when project is selected
  async function loadItems() {
    const project = projects.find((p) => p.id === selectedProjectId);
    if (!project?.pluginPm) return;

    setLoading(true);
    setError(null);
    setPluginId(project.pluginPm);

    try {
      const workItems = await ipc.listPmWorkItems(project.pluginPm);
      // Filter out already-imported items
      const filtered = workItems.filter((wi) => !existingPmIds.has(wi.id));
      setItems(filtered);
      setStep('pick');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Group items by PM project
  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = q
      ? items.filter((i) => i.title.toLowerCase().includes(q) || i.project?.toLowerCase().includes(q))
      : items;

    const groups: Record<string, PmWorkItem[]> = {};
    for (const item of filtered) {
      const key = item.project || t('bulkImport.noProject', 'No project');
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  }, [items, search, t]);

  const totalFiltered = Object.values(grouped).reduce((sum, g) => sum + g.length, 0);

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(groupItems: PmWorkItem[]) {
    const ids = groupItems.map((i) => i.id);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    const allIds = Object.values(grouped).flat().map((i) => i.id);
    const allSelected = allIds.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  async function handleImport() {
    if (!pluginId || selected.size === 0) return;
    setImporting(true);
    setError(null);

    try {
      const importItems: ImportItem[] = [];
      for (const itemId of selected) {
        const item = items.find((i) => i.id === itemId);
        if (!item) continue;

        // Fetch full details via the plugin's fetch operation
        try {
          const details = await ipc.executePluginOperation(pluginId, 'fetch', { pmWorkItemId: itemId }) as Record<string, unknown>;
          importItems.push({
            pmWorkItemId: itemId,
            title: (details.title as string) || item.title,
            description: (details.description as string) || '',
            acceptanceCriteria: Array.isArray(details.criteria) ? details.criteria as string[] : [],
          });
        } catch {
          // Fallback: use basic info from list
          importItems.push({
            pmWorkItemId: itemId,
            title: item.title,
            description: '',
            acceptanceCriteria: [],
          });
        }
      }

      onImport(selectedProjectId, importItems);
    } catch (err) {
      setError((err as Error).message);
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {t('bulkImport.title', 'Import from PM')}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {step === 'select'
                ? t('bulkImport.selectProjectHint', 'Select a project to load its PM requirements')
                : t('bulkImport.pickItemsHint', 'Select the items to import as tasks')}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === 'select' && (
            <div className="space-y-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('bulkImport.labelProject', 'Project')}
              </label>
              {pmProjects.length === 0 ? (
                <div className="text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-6 text-center">
                  {t('bulkImport.noPmProjects', 'No projects have a PM plugin active. Activate a PM plugin in a project first.')}
                </div>
              ) : (
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">{t('form.selectProject', 'Select...')}</option>
                  {pmProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}

              {error && (
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              )}
            </div>
          )}

          {step === 'pick' && (
            <div className="space-y-3">
              {/* Search + select all */}
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('bulkImport.search', 'Search...')}
                  className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={selectAll}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
                >
                  {selected.size === totalFiltered
                    ? t('bulkImport.deselectAll', 'Deselect all')
                    : t('bulkImport.selectAll', 'Select all')}
                </button>
              </div>

              {/* Grouped items */}
              {Object.keys(grouped).length === 0 ? (
                <div className="text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-6 text-center">
                  {search
                    ? t('bulkImport.noResults', 'No items match your search')
                    : t('bulkImport.noItems', 'No pending items found in this PM tool')}
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(grouped).map(([groupName, groupItems]) => (
                    <div key={groupName} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                      {/* Group header */}
                      <div
                        className="bg-gray-50 dark:bg-gray-700/50 px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                        onClick={() => toggleGroup(groupItems)}
                      >
                        <input
                          type="checkbox"
                          checked={groupItems.every((i) => selected.has(i.id))}
                          onChange={() => toggleGroup(groupItems)}
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          {groupName}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          ({groupItems.length})
                        </span>
                      </div>

                      {/* Group items */}
                      <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                        {groupItems.map((item) => (
                          <label
                            key={item.id}
                            className="flex items-start gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(item.id)}
                              onChange={() => toggleItem(item.id)}
                              className="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{item.title}</p>
                              {item.status && (
                                <span className="text-[10px] text-gray-400 dark:text-gray-500">{item.status}</span>
                              )}
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {error && (
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-xs text-gray-400 dark:text-gray-500">
            {step === 'pick' && selected.size > 0 && (
              t('bulkImport.selectedCount', { count: selected.size, defaultValue: `${selected.size} selected` })
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 'pick' && (
              <button
                onClick={() => { setStep('select'); setItems([]); setSelected(new Set()); setSearch(''); }}
                className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-3 py-1.5"
              >
                {t('bulkImport.back', 'Back')}
              </button>
            )}
            <button
              onClick={onClose}
              className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-3 py-1.5"
            >
              {t('form.cancel', 'Cancel')}
            </button>
            {step === 'select' && (
              <button
                onClick={loadItems}
                disabled={!selectedProjectId || loading}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                {loading
                  ? t('bulkImport.loading', 'Loading...')
                  : t('bulkImport.next', 'Next')}
              </button>
            )}
            {step === 'pick' && (
              <button
                onClick={handleImport}
                disabled={selected.size === 0 || importing}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                {importing
                  ? t('bulkImport.importing', 'Importing...')
                  : t('bulkImport.import', { count: selected.size, defaultValue: `Import ${selected.size}` })}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
