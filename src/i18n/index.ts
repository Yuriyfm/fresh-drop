import { en } from './en';
import { ru } from './ru';

export const DEFAULT_LANGUAGE = 'en';
export const LANGUAGE_STORAGE_KEY = 'fresh-drop-language';

export const translations = {
  en,
  ru,
} as const;

export type Language = keyof typeof translations;
export type Translation = (typeof translations)[Language];

export function getStoredLanguage(storage: Storage = window.localStorage): Language {
  return normalizeLanguage(storage.getItem(LANGUAGE_STORAGE_KEY));
}

export function normalizeLanguage(value: string | null): Language {
  return value === 'ru' ? 'ru' : DEFAULT_LANGUAGE;
}
