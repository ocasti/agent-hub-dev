import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project, Plugin, CodeHostingProjectConfig, InstalledAgent, TierName } from '../lib/types';
import { OPTIONAL_SKILLS } from '../lib/skills';
import { selectFolder, getGitRemote, analyzeRepo, getPlugins, getInstalledAgents } from '../lib/ipc';
import { IconLock } from './ui/Icons';
import SkillTag from './ui/SkillTag';

const PHASE_LABELS = [
  { key: '0', label: 'Spec Review' },
  { key: '1', label: 'Plan' },
  { key: '2', label: 'Implement' },
  { key: '3', label: 'Quality Gate' },
  { key: '4', label: 'Ship' },
  { key: '5', label: 'PR Feedback' },
];

interface ProjectFormProps {
  project?: Project;
  onSave: (data: Omit<Project, 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
  licensePlan?: TierName;
  multiAgentMode?: 'global_only' | 'per_project' | 'per_phase';
}

export default function ProjectForm({ project, onSave, onCancel, licensePlan = 'free', multiAgentMode = 'global_only' }: ProjectFormProps) {
  const { t } = useTranslation(['projects', 'common']);
  const [form, setForm] = useState({
    id: project?.id || '',
    name: project?.name || '',
    path: project?.path || '',
    repo: project?.repo || '',
    description: project?.description || '',
    optionalSkills: project?.optionalSkills || [] as string[],
    testCommand: project?.testCommand || '',
    codeHosting: project?.codeHosting || '',
    codeHostingConfig: project?.codeHostingConfig || {} as CodeHostingProjectConfig,
    pluginPm: project?.pluginPm || '',
    pluginPmConfig: project?.pluginPmConfig || {} as Record<string, string>,
    aiAgent: project?.aiAgent || 'claude',
    aiAgentPhases: project?.aiAgentPhases || {} as Record<string, { primary: string; fallback?: string }>,
  });

  const [availablePlugins, setAvailablePlugins] = useState<Plugin[]>([]);
  const [agents, setAgents] = useState<InstalledAgent[]>([]);

  useEffect(() => {
    getPlugins().then(setAvailablePlugins).catch(() => {});
    getInstalledAgents().then(setAgents).catch(() => {});
  }, []);

  const installedAgents = agents.filter((a) => a.installed);

  const codeHostingPlugins = availablePlugins.filter((p) =>
    p.capabilities.includes('ship') || p.capabilities.includes('pr_feedback')
  );
  const pmPlugins = availablePlugins.filter((p) =>
    p.capabilities.includes('pm') || p.capabilities.includes('enrichment')
  );

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzeSuccess, setAnalyzeSuccess] = useState(false);

  const handleAnalyzeRepo = async () => {
    if (!project?.id || !form.path) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalyzeSuccess(false);
    try {
      const result = await analyzeRepo(project.id);
      setForm((prev) => ({ ...prev, description: result }));
      setAnalyzeSuccess(true);
      setTimeout(() => setAnalyzeSuccess(false), 5000);
    } catch (err) {
      setAnalyzeError((err as Error).message || t('form.analyzeError'));
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleSkill = (skillId: string) => {
    setForm((prev) => ({
      ...prev,
      optionalSkills: prev.optionalSkills.includes(skillId)
        ? prev.optionalSkills.filter((s) => s !== skillId)
        : [...prev.optionalSkills, skillId],
    }));
  };

  const skillsByCategory: Record<string, typeof OPTIONAL_SKILLS> = {};
  OPTIONAL_SKILLS.forEach((s) => {
    if (!skillsByCategory[s.category]) skillsByCategory[s.category] = [];
    skillsByCategory[s.category].push(s);
  });

  const save = () => {
    if (!form.name) return;
    onSave(form);
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5 space-y-5">
      <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">{project ? t('form.titleEdit') : t('form.title')}</h3>
      <div className="grid grid-cols-4 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('form.labelName')}</label>
          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('form.labelPath')}</label>
          <div className="flex gap-2">
            <input type="text" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} placeholder={t('form.placeholderPath')} className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
            <button
              type="button"
              onClick={async () => {
                const selected = await selectFolder();
                if (!selected) return;
                const folderName = selected.split('/').pop() || '';
                setForm((prev) => ({
                  ...prev,
                  path: selected,
                  name: prev.name || folderName,
                }));
                const remote = await getGitRemote(selected);
                if (remote) {
                  setForm((prev) => prev.repo ? prev : { ...prev, repo: remote });
                }
              }}
              className="px-3 py-2 text-sm font-medium bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 whitespace-nowrap"
            >
              {t('common:button.browse')}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('form.labelRepo')}</label>
          <input type="text" value={form.repo} readOnly placeholder={t('form.placeholderRepo')} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 text-gray-500 bg-gray-50 rounded-lg px-3 py-2 text-sm outline-none cursor-default" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('form.labelTestCommand')}</label>
        <input type="text" value={form.testCommand} onChange={(e) => setForm({ ...form, testCommand: e.target.value })} placeholder={t('form.placeholderTestCommand')} className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-indigo-500" />
        <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">{t('form.testCommandHelp')}</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{t('form.labelDescription')}</label>
          {project?.id ? (
            <button
              type="button"
              onClick={handleAnalyzeRepo}
              disabled={analyzing || !form.path}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-50 dark:bg-violet-900/30 border border-violet-300 dark:border-violet-600 text-violet-700 dark:text-violet-300 rounded-lg hover:bg-violet-100 dark:hover:bg-violet-900/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {analyzing ? (
                <>
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  {t('form.analyzingRepo')}
                </>
              ) : (
                t('form.analyzeWithAI')
              )}
            </button>
          ) : (
            <span className="text-xs text-gray-400 italic">{t('form.saveFirstHint')}</span>
          )}
        </div>
        {analyzeError && (
          <div className="mb-2 px-3 py-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400">
            {analyzeError}
          </div>
        )}
        {analyzeSuccess && (
          <div className="mb-2 px-3 py-2 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg text-xs text-green-600 dark:text-green-400 flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            {t('form.agentMdCreated')}
          </div>
        )}
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={3}
          placeholder={t('form.placeholderDescription')}
          className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-y"
        />
        <p className="text-xs text-gray-300 mt-1">{t('form.descriptionHelp')}</p>
      </div>

      {/* Plugin selectors */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('form.labelCodeHosting', 'Code Hosting')}</label>
          <select
            value={form.codeHosting}
            onChange={(e) => setForm({ ...form, codeHosting: e.target.value })}
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">{t('form.noPlugin', 'None (manual git)')}</option>
            {codeHostingPlugins.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">{t('form.codeHostingHelp', 'Enables Ship + PR Feedback phases')}</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('form.labelPmTool', 'PM Tool')}</label>
          <select
            value={form.pluginPm}
            onChange={(e) => setForm({ ...form, pluginPm: e.target.value })}
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">{t('form.noPlugin', 'None (manual git)')}</option>
            {pmPlugins.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">{t('form.pmToolHelp', 'Injects requirements into workflow')}</p>
        </div>
      </div>

      {/* Code Hosting Credential Override (per-project) */}
      {form.codeHosting && (
        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              {t('form.credentialOverride', 'Project Credentials')}
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-normal normal-case">
              {t('form.credentialOverrideHelp', 'Override global plugin config for this project')}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('form.labelToken', 'Token')}
              </label>
              <input
                type="password"
                value={form.codeHostingConfig.token || ''}
                onChange={(e) => setForm({ ...form, codeHostingConfig: { ...form.codeHostingConfig, token: e.target.value } })}
                placeholder={t('form.placeholderToken', 'Use global config')}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('form.labelAuthorName', 'Git Author Name')}
              </label>
              <input
                type="text"
                value={form.codeHostingConfig.authorName || ''}
                onChange={(e) => setForm({ ...form, codeHostingConfig: { ...form.codeHostingConfig, authorName: e.target.value } })}
                placeholder={t('form.placeholderAuthorName', 'Use global config')}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('form.labelAuthorEmail', 'Git Author Email')}
              </label>
              <input
                type="text"
                value={form.codeHostingConfig.authorEmail || ''}
                onChange={(e) => setForm({ ...form, codeHostingConfig: { ...form.codeHostingConfig, authorEmail: e.target.value } })}
                placeholder={t('form.placeholderAuthorEmail', 'Use global config')}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* AI Agent Configuration */}
      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
            {t('form.agentTitle', 'AI Agent')}
          </span>
          {multiAgentMode === 'global_only' && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-normal normal-case">
              {t('form.agentControlledByGlobal', 'Controlled by global settings')}
            </span>
          )}
        </div>

        {/* Agent selector — disabled for free tier */}
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            {t('form.agentLabel', 'Agent')}
          </label>
          {multiAgentMode === 'global_only' ? (
            <div className="w-full max-w-xs border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-lg px-3 py-2 text-sm cursor-default">
              {installedAgents.find((a) => a.id === form.aiAgent)?.name || form.aiAgent}
              <span className="text-xs text-gray-400 ml-2">({t('form.agentControlledByGlobal', 'Controlled by global settings')})</span>
            </div>
          ) : (
            <select
              value={form.aiAgent}
              onChange={(e) => setForm({ ...form, aiAgent: e.target.value })}
              className="w-full max-w-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {installedAgents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
              {installedAgents.length === 0 && <option value="claude">Claude Code</option>}
            </select>
          )}
        </div>

        {/* Per-phase timeline — Premium only */}
        <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
              {t('form.agentTimeline', 'Workflow Pipeline')}
            </span>
            {multiAgentMode !== 'per_phase' && (
              <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                <IconLock className="w-3 h-3" /> Premium
              </span>
            )}
          </div>

          {/* Timeline visual */}
          <div className="flex items-start gap-1 overflow-x-auto pb-2">
            {PHASE_LABELS.map((phase, idx) => {
              const phaseConfig = form.aiAgentPhases[phase.key];
              const primaryAgent = phaseConfig?.primary || form.aiAgent;
              const fallbackAgent = phaseConfig?.fallback || '';
              const isLocked = multiAgentMode !== 'per_phase';

              return (
                <div key={phase.key} className="flex flex-col items-center min-w-[100px]">
                  {/* Phase dot + connector */}
                  <div className="flex items-center w-full mb-2">
                    {idx > 0 && <div className="flex-1 h-0.5 bg-gray-300 dark:bg-gray-600" />}
                    <div className={`w-3 h-3 rounded-full flex-shrink-0 ${isLocked ? 'bg-gray-300 dark:bg-gray-600' : 'bg-indigo-500'}`} />
                    {idx < PHASE_LABELS.length - 1 && <div className="flex-1 h-0.5 bg-gray-300 dark:bg-gray-600" />}
                  </div>
                  {/* Phase label */}
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 mb-1.5 text-center leading-tight">
                    {t(`form.phase.${phase.key}`, phase.label)}
                  </span>
                  {/* Agent selectors */}
                  <div className={`w-full rounded-lg border p-1.5 space-y-1 ${isLocked ? 'border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 opacity-60' : 'border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-800'}`}>
                    <select
                      value={primaryAgent}
                      disabled={isLocked}
                      onChange={(e) => {
                        const updated = { ...form.aiAgentPhases };
                        updated[phase.key] = { ...updated[phase.key], primary: e.target.value };
                        setForm({ ...form, aiAgentPhases: updated });
                      }}
                      className="w-full text-[10px] border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-1.5 py-1 outline-none disabled:cursor-default disabled:opacity-70"
                    >
                      {installedAgents.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                      {/* Keep configured agent visible even if not in installedAgents list yet */}
                      {primaryAgent && installedAgents.length > 0 && !installedAgents.some((a) => a.id === primaryAgent) && (
                        <option value={primaryAgent}>{primaryAgent}</option>
                      )}
                      {installedAgents.length === 0 && <option value={primaryAgent}>{primaryAgent}</option>}
                    </select>
                    <select
                      value={fallbackAgent}
                      disabled={isLocked}
                      onChange={(e) => {
                        const updated = { ...form.aiAgentPhases };
                        updated[phase.key] = { primary: updated[phase.key]?.primary || form.aiAgent, fallback: e.target.value || undefined };
                        setForm({ ...form, aiAgentPhases: updated });
                      }}
                      className="w-full text-[10px] border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-1.5 py-1 outline-none disabled:cursor-default disabled:opacity-70"
                    >
                      <option value="">{t('form.agentNoFallback', 'No fallback')}</option>
                      {installedAgents.filter((a) => a.id !== primaryAgent).map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                      {/* Keep configured fallback visible even if not in installedAgents list */}
                      {fallbackAgent && installedAgents.length > 0 && !installedAgents.some((a) => a.id === fallbackAgent) && (
                        <option value={fallbackAgent}>{fallbackAgent}</option>
                      )}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>

          {multiAgentMode !== 'per_phase' && (
            <p className="text-[10px] text-gray-400 mt-1">
              {t('form.agentPremiumHint', 'Unlock per-phase agents & automatic fallback with Premium')}
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wider">{t('form.labelOptionalSkills')}</label>
        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 space-y-3 max-h-64 overflow-y-auto">
          {Object.entries(skillsByCategory).map(([cat, skills]) => (
            <div key={cat}>
              <p className="text-xs text-gray-400 font-semibold mb-1.5">{cat}</p>
              <div className="flex flex-wrap gap-1.5">
                {skills.map((skill) => {
                  const on = form.optionalSkills.includes(skill.id);
                  return (
                    <button
                      key={skill.id}
                      onClick={() => toggleSkill(skill.id)}
                      title={skill.desc}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        on ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 hover:text-gray-700'
                      }`}
                    >
                      {skill.name}
                      {on && <span className="text-indigo-500 text-[10px]">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {form.optionalSkills.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-400 font-medium">{t('form.activeCount', { count: form.optionalSkills.length })}</span>
            {form.optionalSkills.map((s) => (
              <SkillTag key={s} id={s} removable onRemove={() => toggleSkill(s)} size="xs" />
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end pt-2 border-t border-gray-100 dark:border-gray-700">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600">{t('common:button.cancel')}</button>
        <button onClick={save} disabled={!form.name} className="bg-indigo-600 disabled:bg-gray-300 text-white text-sm font-medium px-5 py-2 rounded-lg">
          {t('common:button.save')}
        </button>
      </div>
    </div>
  );
}
