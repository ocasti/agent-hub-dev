import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project, Task, LicenseLimits } from '../lib/types';
import { CORE_SKILLS } from '../lib/skills';
import { refineWithAI, selectImages } from '../lib/ipc';
import SkillTag from './ui/SkillTag';
import { IconWarning, IconCircleDot, IconRuler, IconImage } from './ui/Icons';

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

  const origStatus = task?.status;
  const proj = projects.find((p) => p.id === form.projectId);

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
    });
  };

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

        {refineError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-center justify-between">
            <p className="text-xs text-red-700 dark:text-red-400">{refineError}</p>
            <button onClick={() => setRefineError(null)} className="text-xs text-red-400 hover:text-red-600 ml-4">x</button>
          </div>
        )}

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
              {t('form.modelOpus')}{licenseLimits && !licenseLimits.models.includes('opus') ? ' (Pro)' : ''}
            </option>
          </select>
        </div>

        {/* PM Work Item (shown when project has PM plugin) */}
        {proj?.pluginPm && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider">{t('form.labelPmId', 'PM Work Item ID')}</label>
              <input
                type="text"
                value={form.pmWorkItemId}
                onChange={(e) => setForm({ ...form, pmWorkItemId: e.target.value })}
                placeholder={t('form.placeholderPmId', 'e.g. PROJ-123')}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wider">{t('form.labelPmUrl', 'PM Work Item URL')}</label>
              <input
                type="url"
                value={form.pmWorkItemUrl}
                onChange={(e) => setForm({ ...form, pmWorkItemUrl: e.target.value })}
                placeholder={t('form.placeholderPmUrl', 'https://...')}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        )}

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
