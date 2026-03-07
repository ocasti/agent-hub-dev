import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project } from '../lib/types';
import { CORE_SKILLS } from '../lib/skills';
import ProjectForm from './ProjectForm';
import SkillTag from './ui/SkillTag';
import { IconLock, IconBolt } from './ui/Icons';

interface ProjectsViewProps {
  projects: Project[];
  onSave: (project: Omit<Project, 'createdAt' | 'updatedAt'>) => void;
  onDelete: (id: string) => void;
  onAnalyzeRepo?: (projectId: string) => Promise<void>;
  analyzingProjectId?: string | null;
}

export default function ProjectsView({ projects, onSave, onDelete, onAnalyzeRepo, analyzingProjectId }: ProjectsViewProps) {
  const { t } = useTranslation(['projects', 'common']);
  const [form, setForm] = useState<Project | 'new' | null>(null);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('header.title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">{t('header.subtitle', { count: CORE_SKILLS.length })} <IconLock className="w-3 h-3" /></p>
        </div>
        {!form && (
          <button
            onClick={() => setForm('new')}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            {t('button.new')}
          </button>
        )}
      </div>

      {form && (
        <ProjectForm
          project={form === 'new' ? undefined : form}
          onSave={(data) => {
            onSave(data);
            setForm(null);
          }}
          onCancel={() => setForm(null)}
        />
      )}

      {!form && projects.map((p) => (
        <div key={p.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white font-bold text-sm">
                {p.name[0]?.toUpperCase()}
              </div>
              <div>
                <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">{p.name}</h4>
                <p className="text-xs text-gray-400 font-mono">{p.repo || p.path}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">{t('skills_count', { count: CORE_SKILLS.length + (p.optionalSkills?.length || 0) })}</span>
              {onAnalyzeRepo && (
                <button
                  onClick={() => onAnalyzeRepo(p.id)}
                  disabled={analyzingProjectId === p.id}
                  className="inline-flex items-center gap-1 text-xs text-violet-500 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300 font-medium disabled:opacity-50"
                >
                  {analyzingProjectId === p.id ? (
                    <>
                      <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      {t('button.analyzing')}
                    </>
                  ) : (
                    t('button.analyzeRepo')
                  )}
                </button>
              )}
              <button onClick={() => setForm(p)} className="text-xs text-gray-400 hover:text-indigo-600">{t('button.edit')}</button>
              <button onClick={() => onDelete(p.id)} className="text-xs text-red-400 hover:text-red-600 font-medium">{t('button.delete')}</button>
            </div>
          </div>
          {p.description && (
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
              <p className="text-xs text-gray-500 whitespace-pre-wrap line-clamp-2">{p.description}</p>
            </div>
          )}
          <div className="px-5 py-3 space-y-2">
            <div>
              <p className="text-xs text-indigo-500 font-semibold mb-1.5 flex items-center gap-1"><IconLock className="w-3 h-3" /> {t('section.core')}</p>
              <div className="flex flex-wrap gap-1">
                {CORE_SKILLS.map((s) => <SkillTag key={s.id} id={s.id} locked size="xs" />)}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 font-semibold mb-1.5 flex items-center gap-1">
                <IconBolt className="w-3 h-3" /> {p.optionalSkills?.length > 0 ? t('section.optionalsCount', { count: p.optionalSkills.length }) : t('section.optionals')}
              </p>
              {p.optionalSkills?.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {p.optionalSkills.map((s) => <SkillTag key={s} id={s} size="xs" />)}
                </div>
              ) : (
                <p className="text-xs text-gray-300 italic">{t('noOptionals')}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
