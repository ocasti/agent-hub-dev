import i18n from '../i18n';

const LOCALE_MAP: Record<string, string> = {
  en: 'en-US',
  es: 'es-CO',
};

function getLocale(): string {
  return LOCALE_MAP[i18n.language] || 'en-US';
}

export function formatTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString(getLocale(), { hour12: false });
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString(getLocale());
}
