import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project } from '../lib/types';
import { CORE_SKILLS, OPTIONAL_SKILLS, SKILL_CATEGORIES, findSkill } from '../lib/skills';
import * as ipc from '../lib/ipc';
import { IconLock, IconCircleCheck, IconSquare, IconFolder, IconBook, IconInfo } from './ui/Icons';

interface SkillsViewProps {
  projects: Project[];
  onUpdateProject: (id: string, updates: Partial<Project>) => void;
}

interface GlobalSkill {
  id: string;
  name: string;
  desc: string;
  active: boolean;
}

export default function SkillsView({ projects, onUpdateProject }: SkillsViewProps) {
  const { t } = useTranslation(['skills', 'common']);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [selectedProject, setSelectedProject] = useState<string>(projects[0]?.id || '');
  const [addingGlobal, setAddingGlobal] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [newSkillUrl, setNewSkillUrl] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [globalSkills, setGlobalSkills] = useState<GlobalSkill[]>(() =>
    CORE_SKILLS.map((s) => ({ id: s.id, name: s.name, desc: s.desc, active: true }))
  );

  useEffect(() => {
    ipc.readGlobalSkills().then((sources) => {
      setGlobalSkills((prev) => {
        const map = new Map(prev.map((s) => [s.id, s]));
        sources.forEach((src) => {
          if (!map.has(src)) {
            map.set(src, { id: src, name: src.split('/').pop() || src, desc: 'Custom skill', active: true });
          }
        });
        return Array.from(map.values());
      });
    }).catch(() => {});
  }, []);

  const toggleGlobal = (skillId: string) => {
    setGlobalSkills((prev) =>
      prev.map((s) => (s.id === skillId ? { ...s, active: !s.active } : s))
    );
  };

  const addGlobalSkill = () => {
    if (!newSkillUrl.trim()) return;
    const name = newSkillUrl.split('/').pop() || newSkillUrl;
    setGlobalSkills((prev) => [...prev, { id: newSkillUrl, name, desc: t('global.customDesc'), active: true }]);
    setNewSkillUrl('');
    setAddingGlobal(false);
  };

  const toggleProjectSkill = (skillId: string, projId: string) => {
    const proj = projects.find((p) => p.id === projId);
    if (!proj) return;
    const has = proj.optionalSkills?.includes(skillId);
    onUpdateProject(projId, {
      optionalSkills: has
        ? (proj.optionalSkills || []).filter((s) => s !== skillId)
        : [...(proj.optionalSkills || []), skillId],
    });
  };

  const addProjectSkill = () => {
    if (!newSkillUrl.trim() || !selectedProject) return;
    const proj = projects.find((p) => p.id === selectedProject);
    if (!proj) return;
    onUpdateProject(selectedProject, {
      optionalSkills: [...(proj.optionalSkills || []), newSkillUrl],
    });
    setNewSkillUrl('');
    setAddingProject(false);
  };

  const selProj = projects.find((p) => p.id === selectedProject);

  const filtered = OPTIONAL_SKILLS.filter((s) => {
    if (category !== 'All' && s.category !== category) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q) || s.tags?.some((tg) => tg.includes(q)) || (s.author || '').toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('header.title')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('header.subtitle')}</p>
      </div>

      {/* Global Skills */}
      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-xs font-bold text-indigo-700 uppercase tracking-wider">
              <IconLock className="w-3 h-3 inline-block mr-0.5" /> {t('global.title', { active: globalSkills.filter((s) => s.active).length, total: globalSkills.length })}
            </h3>
            <p className="text-xs text-indigo-400 mt-0.5 font-mono">{t('global.path')}</p>
          </div>
          <button onClick={() => setAddingGlobal(!addingGlobal)} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1.5 rounded-lg">
            {t('global.addButton')}
          </button>
        </div>

        {addingGlobal && (
          <div className="mb-3 flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg p-2.5 border border-indigo-200 dark:border-indigo-800">
            <input
              type="text" value={newSkillUrl} onChange={(e) => setNewSkillUrl(e.target.value)}
              placeholder={t('global.addPlaceholder')}
              className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              onKeyDown={(e) => e.key === 'Enter' && addGlobalSkill()}
            />
            <button onClick={addGlobalSkill} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-4 py-2 rounded-lg">{t('common:button.add')}</button>
            <button onClick={() => { setAddingGlobal(false); setNewSkillUrl(''); }} className="text-xs text-gray-400">x</button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {globalSkills.map((s) => (
            <div key={s.id} className={`border rounded-lg p-3 transition-all ${s.active ? 'bg-white/80 dark:bg-gray-800/80 border-indigo-100 dark:border-indigo-800' : 'bg-gray-100/50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700 opacity-60'}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs">{s.active ? <IconCircleCheck className="w-3.5 h-3.5 text-emerald-600" /> : <IconSquare className="w-3.5 h-3.5 text-gray-400" />}</span>
                  <h4 className={`text-xs font-bold ${s.active ? 'text-gray-800' : 'text-gray-400'}`}>{s.name}</h4>
                </div>
                <button
                  onClick={() => toggleGlobal(s.id)}
                  className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                    s.active ? 'bg-emerald-100 text-emerald-700 hover:bg-red-100 hover:text-red-600' : 'bg-gray-200 text-gray-500 hover:bg-emerald-100 hover:text-emerald-700'
                  }`}
                >
                  {s.active ? 'ON' : 'OFF'}
                </button>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed">{s.desc}</p>
              <p className="text-[10px] text-gray-300 font-mono mt-1">{s.id}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Project Skills */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1"><IconFolder className="w-3.5 h-3.5" /> {t('project.title')}</h3>
            {selProj && <p className="text-xs text-gray-400 mt-0.5 font-mono">{selProj.path}/.claude/settings.json</p>}
          </div>
          <div className="flex items-center gap-2">
            <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)} className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {selProj && (
              <button onClick={() => setAddingProject(!addingProject)} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1.5 rounded-lg">
                {t('project.addButton')}
              </button>
            )}
          </div>
        </div>

        {addingProject && selProj && (
          <div className="mb-3 flex items-center gap-2 bg-gray-50 dark:bg-gray-900 rounded-lg p-2.5 border border-gray-200 dark:border-gray-700">
            <input
              type="text" value={newSkillUrl} onChange={(e) => setNewSkillUrl(e.target.value)}
              placeholder={t('project.addPlaceholder')}
              className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              onKeyDown={(e) => e.key === 'Enter' && addProjectSkill()}
            />
            <button onClick={addProjectSkill} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-4 py-2 rounded-lg">
              {t('project.addTo', { name: selProj.name })}
            </button>
            <button onClick={() => { setAddingProject(false); setNewSkillUrl(''); }} className="text-xs text-gray-400">x</button>
          </div>
        )}

        {selProj ? (
          <div>
            {(!selProj.optionalSkills || selProj.optionalSkills.length === 0) ? (
              <div className="text-center py-8 text-gray-300">
                <p className="text-sm">{t('project.noSkills')}</p>
                <p className="text-xs mt-1">{t('project.noSkillsHint')}</p>
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                {selProj.optionalSkills.map((sId) => {
                  const sk = findSkill(sId);
                  return (
                    <div key={sId} className="flex items-center justify-between bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                      <div className="flex items-center gap-3">
                        <IconCircleCheck className="w-3.5 h-3.5 text-emerald-600" />
                        <div>
                          <h4 className="text-xs font-bold text-gray-800 dark:text-gray-200">{sk?.name || sId}</h4>
                          {sk && <p className="text-[10px] text-gray-400">{sk.desc}</p>}
                        </div>
                      </div>
                      <button
                        onClick={() => toggleProjectSkill(sId, selProj.id)}
                        className="text-xs bg-red-50 text-red-500 hover:bg-red-100 font-medium px-2.5 py-1 rounded"
                      >
                        {t('project.deactivate')}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="bg-gray-950 rounded-lg p-3 mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-gray-500 font-mono">{selProj.path}/.claude/settings.json</span>
                <span className="text-[10px] text-gray-600">{t('project.preview')}</span>
              </div>
              <pre className="text-xs text-gray-300 font-mono">
                {JSON.stringify({ settingSources: selProj.optionalSkills || [] }, null, 2)}
              </pre>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-300"><p className="text-sm">{t('project.selectProject')}</p></div>
        )}
      </div>

      {/* Catalog */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1"><IconBook className="w-3.5 h-3.5" /> {t('catalog.title', { filtered: filtered.length, total: OPTIONAL_SKILLS.length })}</h3>
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t('catalog.searchPlaceholder')}
            className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-1.5 text-xs w-56 outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Category filter */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {SKILL_CATEGORIES.map((cat) => {
            const count = cat === 'All' ? OPTIONAL_SKILLS.length : OPTIONAL_SKILLS.filter((s) => s.category === cat).length;
            if (count === 0 && cat !== 'All') return null;
            return (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                  category === cat
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {filtered.map((s) => {
            const usedIn = projects.filter((p) => p.optionalSkills?.includes(s.id));
            return (
              <div key={s.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:border-indigo-200 dark:hover:border-indigo-700 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">{s.name}</h4>
                      <span className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">{s.category}</span>
                      {s.install && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                          s.install === 'plugin marketplace' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' :
                          s.install.startsWith('plugin install') ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' :
                          s.install.startsWith('npx') ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' :
                          s.install === 'git clone' ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' :
                          'bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                        }`}>{s.install}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">{s.desc}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-gray-300 dark:text-gray-600 font-mono">{s.id}</span>
                      {s.tags?.map((tg) => (
                        <span key={tg} className="text-[10px] bg-gray-50 dark:bg-gray-900 text-gray-400 px-1 py-0.5 rounded">{tg}</span>
                      ))}
                    </div>
                  </div>
                  <div className="relative flex-shrink-0 ml-3">
                    <button
                      onClick={() => setTarget(target === s.id ? null : s.id)}
                      className={`text-xs font-medium px-3 py-1.5 rounded-lg whitespace-nowrap ${
                        usedIn.length > 0
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      }`}
                    >
                      {usedIn.length > 0 ? `ON (${usedIn.length})` : t('catalog.activate')}
                    </button>
                    {target === s.id && projects.length > 0 && (
                      <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-20 py-1 min-w-[220px]">
                        <p className="px-3 py-1.5 text-xs text-gray-400 font-semibold border-b border-gray-100 dark:border-gray-700">{t('catalog.toggleByProject')}</p>
                        {projects.map((p) => {
                          const on = p.optionalSkills?.includes(s.id);
                          return (
                            <button
                              key={p.id}
                              onClick={() => toggleProjectSkill(s.id, p.id)}
                              className="w-full text-left px-3 py-2.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between"
                            >
                              <span className="text-gray-700 dark:text-gray-300 font-medium">{p.name}</span>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${on ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}>
                                {on ? 'ON' : 'OFF'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                {usedIn.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-50 dark:border-gray-700 flex items-center gap-1.5 flex-wrap">
                    {usedIn.map((p) => (
                      <span key={p.id} className="text-xs bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-medium">{p.name}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-2 text-center py-8 text-gray-300 dark:text-gray-600">
              <p className="text-sm">{category !== 'All' ? t('catalog.noResultsIn', { search, category }) : t('catalog.noResults', { search })}</p>
            </div>
          )}
        </div>
      </div>

      {/* How it works */}
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <h4 className="text-xs font-bold text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-1"><IconInfo className="w-3.5 h-3.5" /> {t('howItWorks.title')}</h4>
        <div className="grid grid-cols-2 gap-4 text-xs text-gray-500 dark:text-gray-400">
          <div>
            <p className="font-semibold text-gray-700 mb-1">{t('howItWorks.globalTitle')}</p>
            <p>{t('howItWorks.globalDesc')}</p>
          </div>
          <div>
            <p className="font-semibold text-gray-700 mb-1">{t('howItWorks.projectTitle')}</p>
            <p>{t('howItWorks.projectDesc')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
