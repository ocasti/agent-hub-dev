import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project, Task, LicenseLimits, PluginTaskField, Subtask, PluginCriterion } from '../lib/types';
import { CORE_SKILLS } from '../lib/skills';
import { refineWithAI, selectImages, getTaskFieldsForProject, executePluginOperation, listPmWorkItems, refreshSubtasks } from '../lib/ipc';
import SkillTag from './ui/SkillTag';
import { IconWarning, IconCircleDot, IconRuler, IconImage, IconRefresh } from './ui/Icons';

// ── Types for dynamic field state ────────────────────────────────────────────

interface SelectOption {
  id: string;
  title: string;
  status?: string;
  project?: string;
  [key: string]: unknown;
}

interface FieldState {
  options: SelectOption[];
  loading: boolean;
  error: boolean;
  search: string;
  open: boolean;
  fetching: boolean; // fetching detail after selection
}

// ── Plugin Select Field Component ────────────────────────────────────────────

function PluginSelectField({
  field,
  value,
  state,
  onStateChange,
  onSelect,
  onClear,
  containerRef,
}: {
  field: PluginTaskField;
  value: string;
  state: FieldState;
  onStateChange: (updates: Partial<FieldState>) => void;
  onSelect: (item: SelectOption) => void;
  onClear: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const selectedItem = state.options.find((item) => item.id === value);
  const filtered = state.options.filter((item) => {
    const q = state.search.toLowerCase();
    return item.title.toLowerCase().includes(q) || item.id.toLowerCase().includes(q);
  });

  if (state.loading) {
    return (
      <div className="flex items-center gap-2 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5">
        <span className="inline-block w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-amber-600 dark:text-amber-400">Could not load options. Enter manually:</p>
        <input
          type="text"
          value={value}
          onChange={(e) => onSelect({ id: e.target.value, title: e.target.value })}
          placeholder={field.placeholder}
          className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {state.fetching && (
        <div className="absolute inset-0 bg-white/60 dark:bg-gray-800/60 z-30 rounded-lg flex items-center justify-center">
          <span className="inline-block w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          <span className="ml-2 text-xs text-gray-500">Loading details...</span>
        </div>
      )}

      {selectedItem && !state.open ? (
        <button
          type="button"
          onClick={() => onStateChange({ open: true, search: '' })}
          className="w-full flex items-center justify-between border border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded-lg px-3 py-2.5 text-sm text-left hover:border-indigo-400 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-gray-900 dark:text-white truncate">{selectedItem.title}</span>
            {selectedItem.status && (
              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300">
                {selectedItem.status}
              </span>
            )}
          </div>
          <span
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="flex-shrink-0 text-gray-400 hover:text-red-500 ml-2 text-xs"
          >x</span>
        </button>
      ) : (
        <input
          type="text"
          value={state.search}
          onChange={(e) => onStateChange({ search: e.target.value, open: true })}
          onFocus={() => onStateChange({ open: true })}
          placeholder={field.placeholder || 'Search...'}
          className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
      )}

      {state.open && (
        <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">
              {state.options.length === 0 ? 'No items found' : 'No matches'}
            </div>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item)}
                className={`w-full text-left px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors ${
                  item.id === value ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-900 dark:text-white truncate">{item.title}</span>
                  {item.status && (
                    <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                      {item.status}
                    </span>
                  )}
                </div>
                {item.project && (
                  <p className="text-[11px] text-gray-400 mt-0.5">{item.project}</p>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main TaskForm ────────────────────────────────────────────────────────────

interface TaskFormProps {
  projects: Project[];
  task?: Task;
  licenseLimits?: LicenseLimits;
  onSave: (data: Partial<Task>) => void;
  onCancel: () => void;
}

export default function TaskForm({ projects, task, licenseLimits, onSave, onCancel }: TaskFormProps) {
  const { t } = useTranslation('tasks');
  const [form, setForm] = useState({
    projectId: task?.projectId || '',
    title: task?.title || '',
    description: task?.description || '',
    acceptanceCriteria: task?.acceptanceCriteria?.join('\n') || '',
    images: task?.images || [] as { url: string }[],
    model: task?.model || 'sonnet' as 'sonnet' | 'opus',
    pmWorkItemId: task?.pmWorkItemId || '',
    pmWorkItemUrl: task?.pmWorkItemUrl || '',
  });

  const [refining, setRefining] = useState<'description' | 'acceptanceCriteria' | null>(null);
  const [refineError, setRefineError] = useState<string | null>(null);

  // Plugin task fields
  const [pluginFields, setPluginFields] = useState<PluginTaskField[]>([]);
  const [fieldStates, setFieldStates] = useState<Record<string, FieldState>>({});
  const fieldRefs = useRef<Record<string, React.RefObject<HTMLDivElement | null>>>({});
  // Extra form values from plugin fields (beyond pmWorkItemId/pmWorkItemUrl)
  const [extraFields, setExtraFields] = useState<Record<string, string>>({});
  // PM subtasks fetched when user selects a PM work item
  const [pmSubtasks, setPmSubtasks] = useState<{ pluginId: string; subtasks: Subtask[] } | null>(() => {
    if (task?.pluginContext) {
      for (const [pid, data] of Object.entries(task.pluginContext)) {
        if (data.subtasks && data.subtasks.length > 0) {
          return { pluginId: pid, subtasks: data.subtasks };
        }
      }
    }
    return null;
  });
  // PM criteria (acceptance criteria with IDs from PM tool)
  const [pmCriteria, setPmCriteria] = useState<{ pluginId: string; criteria: PluginCriterion[] } | null>(() => {
    if (task?.pluginContext) {
      for (const [pid, data] of Object.entries(task.pluginContext)) {
        if (data.criteria && data.criteria.length > 0) {
          return { pluginId: pid, criteria: data.criteria };
        }
      }
    }
    return null;
  });
  const [refreshingPmData, setRefreshingPmData] = useState(false);

  const origStatus = task?.status;
  const proj = projects.find((p) => p.id === form.projectId);

  // Load plugin task fields when project changes
  useEffect(() => {
    if (!form.projectId) {
      setPluginFields([]);
      setFieldStates({});
      return;
    }
    let cancelled = false;
    getTaskFieldsForProject(form.projectId)
      .then((fields) => {
        if (cancelled) return;
        setPluginFields(fields);
        // Initialize field states
        const states: Record<string, FieldState> = {};
        for (const f of fields) {
          states[f.key] = { options: [], loading: !!f.source, error: false, search: '', open: false, fetching: false };
        }
        setFieldStates(states);

        // Load options for select fields with source
        for (const f of fields) {
          if (f.type === 'select' && f.source) {
            listPmWorkItems(f.pluginId)
              .then((items) => {
                if (cancelled) return;
                setFieldStates((prev) => ({
                  ...prev,
                  [f.key]: { ...prev[f.key], options: items as SelectOption[], loading: false },
                }));
              })
              .catch(() => {
                if (cancelled) return;
                setFieldStates((prev) => ({
                  ...prev,
                  [f.key]: { ...prev[f.key], error: true, loading: false },
                }));
              });
          }
        }
      })
      .catch(() => {
        if (!cancelled) setPluginFields([]);
      });
    return () => { cancelled = true; };
  }, [form.projectId]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      setFieldStates((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [key, state] of Object.entries(next)) {
          if (state.open) {
            const ref = fieldRefs.current[key];
            if (ref?.current && !ref.current.contains(e.target as Node)) {
              next[key] = { ...state, open: false };
              changed = true;
            }
          }
        }
        return changed ? next : prev;
      });
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Handle plugin field selection with onSelect.fetch + fill
  const handlePluginSelect = useCallback(async (field: PluginTaskField, item: SelectOption) => {
    // Set the field value immediately
    const formKey = field.key as keyof typeof form;
    if (formKey in form) {
      setForm((prev) => ({ ...prev, [formKey]: item.id }));
    } else {
      setExtraFields((prev) => ({ ...prev, [field.key]: item.id }));
    }
    setFieldStates((prev) => ({
      ...prev,
      [field.key]: { ...prev[field.key], open: false, search: '' },
    }));

    // If field has onSelect.fetch, fetch detail and fill form
    if (field.onSelect?.fetch) {
      setFieldStates((prev) => ({
        ...prev,
        [field.key]: { ...prev[field.key], fetching: true },
      }));

      try {
        // Resolve args: replace $.xxx with values from the selected item
        const resolvedArgs: Record<string, string> = {};
        for (const [k, v] of Object.entries(field.onSelect.fetch.args)) {
          if (v.startsWith('$.')) {
            const prop = v.slice(2);
            resolvedArgs[k] = String(item[prop] ?? item.id);
          } else {
            resolvedArgs[k] = v;
          }
        }

        const result = await executePluginOperation(field.pluginId, field.onSelect.fetch.operation, resolvedArgs);
        const data = result as Record<string, unknown>;

        // Apply fill mappings
        if (field.onSelect.fill && data) {
          const updates: Partial<typeof form> = {};
          for (const [formField, path] of Object.entries(field.onSelect.fill)) {
            const prop = path.replace(/^\$\./, '');
            const value = data[prop];
            if (value !== undefined && value !== null) {
              if (formField === 'acceptanceCriteria' && Array.isArray(value)) {
                updates[formField] = value.join('\n');
              } else {
                (updates as Record<string, unknown>)[formField] = String(value);
              }
            }
          }
          if (Object.keys(updates).length > 0) {
            setForm((prev) => ({ ...prev, ...updates }));
          }
        }

        // Extract PM subtasks and criteria from the fieldMap-transformed response
        if (data) {
          const descs = data.subtasks as string[] | undefined;
          const ids = data.subtaskIds as string[] | undefined;
          const stCompleted = data.subtasksCompleted as unknown[] | undefined;
          if (Array.isArray(descs) && descs.length > 0) {
            setPmSubtasks({
              pluginId: field.pluginId,
              subtasks: descs.map((desc, i) => ({
                id: String(ids?.[i] ?? ''),
                description: String(desc),
                completed: Array.isArray(stCompleted) ? !!stCompleted[i] : false,
              })),
            });
          } else {
            setPmSubtasks(null);
          }

          const cDescs = data.criteria as string[] | undefined;
          const cIds = data.criteriaIds as string[] | undefined;
          const crCompleted = data.criteriaCompleted as unknown[] | undefined;
          if (Array.isArray(cDescs) && cDescs.length > 0) {
            setPmCriteria({
              pluginId: field.pluginId,
              criteria: cDescs.map((desc, i) => ({
                id: String(cIds?.[i] ?? ''),
                description: String(desc),
                completed: Array.isArray(crCompleted) ? !!crCompleted[i] : false,
              })),
            });
          } else {
            setPmCriteria(null);
          }
        }
      } catch (err) {
        console.error(`[TaskForm] Failed to fetch detail for ${field.key}:`, err);
      } finally {
        setFieldStates((prev) => ({
          ...prev,
          [field.key]: { ...prev[field.key], fetching: false },
        }));
      }
    }
  }, [form]);

  const handlePluginClear = useCallback((field: PluginTaskField) => {
    const formKey = field.key as keyof typeof form;
    if (formKey in form) {
      setForm((prev) => ({ ...prev, [formKey]: '' }));
    } else {
      setExtraFields((prev) => ({ ...prev, [field.key]: '' }));
    }
    // Clear PM data when the PM item is cleared
    if (field.key === 'pmWorkItemId') {
      setPmSubtasks(null);
      setPmCriteria(null);
    }
  }, [form]);

  const handleRefine = async (field: 'description' | 'acceptanceCriteria') => {
    if (!form.title && !form.description) return;
    setRefining(field);
    setRefineError(null);
    try {
      const result = await refineWithAI({
        field,
        title: form.title,
        description: form.description,
        acceptanceCriteria: form.acceptanceCriteria,
        projectId: form.projectId,
      });
      if (result) {
        setForm((prev) => ({ ...prev, [field]: result }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[refineWithAI]', msg);
      setRefineError(t('form.refineError', { error: msg }));
    } finally {
      setRefining(null);
    }
  };

  const save = () => {
    if (!form.projectId || !form.title) return;
    const criteria = form.acceptanceCriteria
      .split('\n')
      .map((c) => c.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean);
    // Build pluginContext with PM subtasks and criteria if available
    let pluginContext: Record<string, Record<string, unknown>> | undefined;
    const pmPluginId = pmSubtasks?.pluginId || pmCriteria?.pluginId;
    if (pmPluginId) {
      const ctx: Record<string, unknown> = {};
      if (pmSubtasks) ctx.subtasks = pmSubtasks.subtasks;
      if (pmCriteria) ctx.criteria = pmCriteria.criteria;
      pluginContext = { [pmPluginId]: ctx };
    }

    onSave({
      id: task?.id,
      projectId: form.projectId,
      title: form.title,
      description: form.description,
      acceptanceCriteria: criteria,
      images: form.images,
      model: form.model,
      pmWorkItemId: form.pmWorkItemId || undefined,
      pmWorkItemUrl: form.pmWorkItemUrl || undefined,
      pluginContext,
    });
  };

  // ── Render a plugin field ──────────────────────────────────────────────────

  const renderPluginField = (field: PluginTaskField) => {
    const state = fieldStates[field.key];
    if (!state) return null;

    // Ensure ref exists for this field
    if (!fieldRefs.current[field.key]) {
      fieldRefs.current[field.key] = { current: null };
    }

    const value = field.key in form
      ? (form as Record<string, unknown>)[field.key] as string
      : extraFields[field.key] || '';

    return (
      <div key={field.key}>
        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
          {field.label}
        </label>
        {field.type === 'select' ? (
          <PluginSelectField
            field={field}
            value={value}
            state={state}
            onStateChange={(updates) => setFieldStates((prev) => ({
              ...prev,
              [field.key]: { ...prev[field.key], ...updates },
            }))}
            onSelect={(item) => handlePluginSelect(field, item)}
            onClear={() => handlePluginClear(field)}
            containerRef={fieldRefs.current[field.key]}
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => {
              const formKey = field.key as keyof typeof form;
              if (formKey in form) {
                setForm((prev) => ({ ...prev, [formKey]: e.target.value }));
              } else {
                setExtraFields((prev) => ({ ...prev, [field.key]: e.target.value }));
              }
            }}
            placeholder={field.placeholder}
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        )}
      </div>
    );
  };

  // ── Resolve fields by position ─────────────────────────────────────────────

  const getFieldsForPosition = (pos: string) =>
    pluginFields.filter((f) => f.position === pos).map(renderPluginField);

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{task ? t('form.titleEdit') : t('form.title')}</h2>
        <button onClick={onCancel} className="text-sm text-gray-400">{t('form.cancel')}</button>
      </div>

      {origStatus === 'pr_feedback' && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <IconWarning className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">{t('form.warningPR', { prNumber: task?.prNumber })}</p>
              <p className="text-xs text-amber-700 mt-1">{t('form.warningPRDetail')}</p>
            </div>
          </div>
        </div>
      )}

      {origStatus === 'completed' && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <IconCircleDot className="w-5 h-5 text-red-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-800">{t('form.warningCompleted')}</p>
              <p className="text-xs text-red-700 mt-1">{t('form.warningCompletedDetail')}</p>
            </div>
          </div>
        </div>
      )}

      {task?.specSuggestions && task.specSuggestions.length > 0 && (
        <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <IconRuler className="w-5 h-5 text-cyan-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-cyan-800">{t('form.specSuggestions')}</p>
              <div className="mt-2 space-y-1.5">
                {task.specSuggestions.map((s, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-cyan-500 text-xs mt-0.5">-&gt;</span>
                    <span className="text-xs text-cyan-700">{s}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-5">
        {/* form.start */}
        {getFieldsForPosition('form.start')}

        {/* Project */}
        {getFieldsForPosition('before:project')}
        <div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider">{t('form.labelProject')}</label>
          <select
            value={form.projectId}
            onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">{t('form.selectProject')}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {proj && (
            <div className="mt-2 bg-gray-50 dark:bg-gray-900 rounded-lg p-2.5">
              <p className="text-xs text-gray-400 mb-1 font-medium">{t('form.activeSkills')}</p>
              <div className="flex flex-wrap gap-1">
                {CORE_SKILLS.map((s) => <SkillTag key={s.id} id={s.id} locked size="xs" />)}
                {proj.optionalSkills?.map((s) => <SkillTag key={s} id={s} size="xs" />)}
              </div>
            </div>
          )}
        </div>
        {getFieldsForPosition('after:project')}

        {/* Title */}
        {getFieldsForPosition('before:title')}
        <div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider">{t('form.labelTitle')}</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder={t('form.placeholderTitle')}
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        {getFieldsForPosition('after:title')}

        {refineError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-center justify-between">
            <p className="text-xs text-red-700 dark:text-red-400">{refineError}</p>
            <button onClick={() => setRefineError(null)} className="text-xs text-red-400 hover:text-red-600 ml-4">x</button>
          </div>
        )}

        {/* Description / Spec */}
        {getFieldsForPosition('before:description')}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{t('form.labelSpec')}</label>
            <button
              type="button"
              onClick={() => handleRefine('description')}
              disabled={refining !== null || (!form.title && !form.description)}
              className="text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30"
            >
              {refining === 'description' ? (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                  {t('form.refining')}
                </span>
              ) : (
                t('form.refineWithAI')
              )}
            </button>
          </div>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={6}
            placeholder={t('form.placeholderSpec')}
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-y"
          />
        </div>
        {getFieldsForPosition('after:description')}

        {/* Acceptance Criteria */}
        {getFieldsForPosition('before:criteria')}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{t('form.labelCriteria')}</label>
            <button
              type="button"
              onClick={() => handleRefine('acceptanceCriteria')}
              disabled={refining !== null || (!form.title && !form.description)}
              className="text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30"
            >
              {refining === 'acceptanceCriteria' ? (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                  {t('form.refining')}
                </span>
              ) : (
                t('form.refineWithAI')
              )}
            </button>
          </div>
          <textarea
            value={form.acceptanceCriteria}
            onChange={(e) => setForm({ ...form, acceptanceCriteria: e.target.value })}
            rows={5}
            placeholder={t('form.placeholderCriteria')}
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-y"
          />
          <p className="text-xs text-gray-300 mt-1">{t('form.criteriaHelp')}</p>
        </div>
        {getFieldsForPosition('after:criteria')}

        {/* PM Data sections (read-only preview with shared refresh) */}
        {form.pmWorkItemId && (
          <>
            {/* Refresh button for all PM data */}
            {task?.id && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={async () => {
                    setRefreshingPmData(true);
                    try {
                      const updated = await refreshSubtasks(task!.id);
                      if (updated.pluginContext) {
                        for (const [pid, data] of Object.entries(updated.pluginContext)) {
                          setPmSubtasks(data.subtasks?.length ? { pluginId: pid, subtasks: data.subtasks } : null);
                          setPmCriteria(data.criteria?.length ? { pluginId: pid, criteria: data.criteria } : null);
                          break;
                        }
                      }
                    } catch (err) {
                      console.error('Failed to refresh PM data:', err);
                    } finally {
                      setRefreshingPmData(false);
                    }
                  }}
                  disabled={refreshingPmData}
                  className="text-xs text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-1 hover:text-indigo-800 dark:hover:text-indigo-300 disabled:opacity-50"
                >
                  <IconRefresh className={`w-3 h-3 ${refreshingPmData ? 'animate-spin' : ''}`} />
                  {t('detail.refreshSubtasks', 'Refresh from PM')}
                </button>
              </div>
            )}

            {/* PM Criteria */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider flex items-center gap-2">
                {t('detail.pmCriteria', 'PM Criteria')}
                {pmCriteria && pmCriteria.criteria.length > 0 && (
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    pmCriteria.criteria.filter((c) => c.completed).length === pmCriteria.criteria.length
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  }`}>
                    {pmCriteria.criteria.filter((c) => c.completed).length}/{pmCriteria.criteria.length}
                  </span>
                )}
              </label>
              {pmCriteria && pmCriteria.criteria.length > 0 ? (
                <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-3 space-y-1.5 bg-gray-50 dark:bg-gray-900">
                  {pmCriteria.criteria.map((cr) => (
                    <div key={cr.id} className="flex items-center gap-2">
                      <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] flex-shrink-0 ${
                        cr.completed
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                      }`}>
                        {cr.completed ? '✓' : '○'}
                      </span>
                      <span className={`text-sm ${cr.completed ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                        {cr.description}
                      </span>
                    </div>
                  ))}
                </div>
              ) : form.acceptanceCriteria.trim() ? (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                    {t('form.criteriaAsTextHint', 'Criteria are plain text. Convert to a trackable checklist?')}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const lines = form.acceptanceCriteria
                        .split('\n')
                        .map((l) => l.replace(/^[-•*\d.)\]]\s*/, '').trim())
                        .filter(Boolean);
                      if (lines.length > 0) {
                        const pluginId = proj?.pluginPm || '_local';
                        setPmCriteria({
                          pluginId,
                          criteria: lines.map((desc, i) => ({
                            id: `local-${Date.now()}-${i}`,
                            description: desc,
                            completed: false,
                          })),
                        });
                      }
                    }}
                    className="text-xs font-medium px-2.5 py-1 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                  >
                    {t('form.convertToChecklist', 'Convert to checklist')}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                  {t('detail.noPmCriteria', 'No PM criteria. Click refresh to fetch.')}
                </p>
              )}
            </div>

            {/* PM Subtasks */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider flex items-center gap-2">
                {t('detail.subtasks', 'Subtasks')}
                {pmSubtasks && pmSubtasks.subtasks.length > 0 && (
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    pmSubtasks.subtasks.filter((s) => s.completed).length === pmSubtasks.subtasks.length
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  }`}>
                    {pmSubtasks.subtasks.filter((s) => s.completed).length}/{pmSubtasks.subtasks.length}
                  </span>
                )}
              </label>
              {pmSubtasks && pmSubtasks.subtasks.length > 0 ? (
                <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-3 space-y-1.5 bg-gray-50 dark:bg-gray-900">
                  {pmSubtasks.subtasks.map((st) => (
                    <div key={st.id} className="flex items-center gap-2">
                      <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] flex-shrink-0 ${
                        st.completed
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                      }`}>
                        {st.completed ? '✓' : '○'}
                      </span>
                      <span className={`text-sm ${st.completed ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                        {st.description}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                  {t('detail.noSubtasks', 'No subtasks yet. Click refresh to fetch from PM.')}
                </p>
              )}
            </div>
          </>

        )}

        {/* Images */}
        {getFieldsForPosition('before:images')}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{t('form.labelImages')}</label>
            <button
              onClick={async () => {
                const paths = await selectImages();
                if (paths.length > 0) {
                  const newImages = paths.map(p => ({ url: p }));
                  setForm({ ...form, images: [...form.images, ...newImages] });
                }
              }}
              className="text-xs text-indigo-600 font-medium"
            >
              {t('form.addImage')}
            </button>
          </div>
          {form.images.length === 0 ? (
            <button
              type="button"
              onClick={async () => {
                const paths = await selectImages();
                if (paths.length > 0) {
                  const newImages = paths.map(p => ({ url: p }));
                  setForm({ ...form, images: [...form.images, ...newImages] });
                }
              }}
              className="w-full border border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-3 text-center text-xs text-gray-400 hover:border-indigo-400 hover:text-indigo-400 transition-colors cursor-pointer"
            >
              {t('form.imagesPlaceholder')}
            </button>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {form.images.map((img, i) => (
                <div key={i} className="relative bg-gray-100 dark:bg-gray-700 rounded-lg p-1 group">
                  <img
                    src={img.url}
                    alt=""
                    className="w-20 h-14 object-cover rounded"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                  <div className="hidden w-20 h-14 bg-gray-200 dark:bg-gray-600 rounded flex items-center justify-center text-gray-400">
                    <IconImage className="w-4 h-4" />
                  </div>
                  <button
                    onClick={() => setForm({ ...form, images: form.images.filter((_, j) => j !== i) })}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        {getFieldsForPosition('after:images')}

        {/* Model */}
        {getFieldsForPosition('before:model')}
        <div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider">{t('form.labelModel')}</label>
          <select
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value as 'sonnet' | 'opus' })}
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="sonnet">{t('form.modelSonnet')}</option>
            <option
              value="opus"
              disabled={licenseLimits ? !licenseLimits.models.includes('opus') : false}
            >
              {t('form.modelOpus')}{licenseLimits && !licenseLimits.models.includes('opus') ? ' (Premium)' : ''}
            </option>
          </select>
        </div>
        {getFieldsForPosition('after:model')}

        {/* form.end */}
        {getFieldsForPosition('form.end')}

        <div className="flex justify-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onCancel} className="px-4 py-2.5 text-sm text-gray-600">{t('form.cancel')}</button>
          {origStatus && origStatus !== 'queued' ? (
            <button onClick={save} disabled={!form.projectId || !form.title} className="bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 text-white text-sm font-medium px-6 py-2.5 rounded-lg">
              {t('form.saveAndRequeue')}
            </button>
          ) : (
            <button onClick={save} disabled={!form.projectId || !form.title} className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white text-sm font-medium px-6 py-2.5 rounded-lg">
              {task ? t('form.saveChanges') : t('form.createTask')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
