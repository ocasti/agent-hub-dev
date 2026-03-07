import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// English
import enCommon from './locales/en/common.json';
import enWorkflow from './locales/en/workflow.json';
import enTasks from './locales/en/tasks.json';
import enDashboard from './locales/en/dashboard.json';
import enProjects from './locales/en/projects.json';
import enSkills from './locales/en/skills.json';
import enKnowledge from './locales/en/knowledge.json';
import enSettings from './locales/en/settings.json';
import enLogs from './locales/en/logs.json';

// Spanish
import esCommon from './locales/es/common.json';
import esWorkflow from './locales/es/workflow.json';
import esTasks from './locales/es/tasks.json';
import esDashboard from './locales/es/dashboard.json';
import esProjects from './locales/es/projects.json';
import esSkills from './locales/es/skills.json';
import esKnowledge from './locales/es/knowledge.json';
import esSettings from './locales/es/settings.json';
import esLogs from './locales/es/logs.json';

i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: enCommon,
      workflow: enWorkflow,
      tasks: enTasks,
      dashboard: enDashboard,
      projects: enProjects,
      skills: enSkills,
      knowledge: enKnowledge,
      settings: enSettings,
      logs: enLogs,
    },
    es: {
      common: esCommon,
      workflow: esWorkflow,
      tasks: esTasks,
      dashboard: esDashboard,
      projects: esProjects,
      skills: esSkills,
      knowledge: esKnowledge,
      settings: esSettings,
      logs: esLogs,
    },
  },
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
