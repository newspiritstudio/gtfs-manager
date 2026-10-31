export const LOCALES = ['ca', 'es', 'en', 'fr', 'de', 'it', 'pt', 'zh', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];
/**
 * The language without a prefix in public addresses (`/`, `/catalog`) and the one used when
 * nothing is known about the visitor: English, because that is what search engines see. Texts
 * missing in a language appear in Catalan, the source of the translations (`MESSAGES.ca`).
 */
export const DEFAULT_LOCALE: Locale = 'en';
/** Where the chosen language is remembered (localStorage). */
export const LOCALE_STORAGE_KEY = 'gtfs-locale';

/** Each language's name in itself: that is how someone who does not understand the current language looks for it. */
export const LOCALE_NAMES: Record<Locale, string> = {
  ca: 'Català',
  es: 'Español',
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  zh: '简体中文',
  ja: '日本語',
};

/** BCP 47 tag for `<html lang>`, `hreflang` and `Intl` (Chinese is Simplified). */
export const LOCALE_TAGS: Record<Locale, string> = {
  ca: 'ca',
  es: 'es',
  en: 'en',
  fr: 'fr',
  de: 'de',
  it: 'it',
  pt: 'pt',
  zh: 'zh-Hans',
  ja: 'ja',
};

/** Codi d'Open Graph (`og:locale`). */
export const OG_LOCALES: Record<Locale, string> = {
  ca: 'ca_ES',
  es: 'es_ES',
  en: 'en_US',
  fr: 'fr_FR',
  de: 'de_DE',
  it: 'it_IT',
  pt: 'pt_PT',
  zh: 'zh_CN',
  ja: 'ja_JP',
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
