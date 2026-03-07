import i18n from 'i18next';
import path from 'path';
import fs from 'fs';

function loadJSON(filePath: string): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

// Resolve locale directory — works for both dev and packaged
function localesDir(): string {
  return path.join(__dirname, 'i18n', 'locales');
}

const i18nMain = i18n.createInstance();

i18nMain.init({
  resources: {
    en: { menu: loadJSON(path.join(localesDir(), 'en', 'menu.json')) },
    es: { menu: loadJSON(path.join(localesDir(), 'es', 'menu.json')) },
  },
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'menu',
  interpolation: {
    escapeValue: false,
  },
});

export default i18nMain;
