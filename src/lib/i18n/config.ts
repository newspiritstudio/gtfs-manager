export const LOCALES = ['ca', 'es', 'en', 'fr', 'de', 'it', 'pt', 'zh', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];
/**
 * L'idioma sense prefix a les adreces públiques (`/`, `/catalog`) i el que es fa servir quan no se
 * sap res del visitant: l'anglès, perquè és el que veuen els cercadors. Els textos que falten en un
 * idioma surten en català, la font de les traduccions (`MESSAGES.ca`).
 */
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'gtfs-locale';

/** El nom de cada idioma en ell mateix: és com el busca qui no entén l'idioma actual. */
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

/** Etiqueta BCP 47 per a `<html lang>`, `hreflang` i `Intl` (el xinès és el simplificat). */
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
