import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from './config';

/**
 * Les pàgines públiques (inici i catàleg) tenen una adreça per idioma perquè els cercadors en
 * puguin indexar cada versió: `/ca/catalog`, `/fr/catalog`. L'anglès (`DEFAULT_LOCALE`) no porta
 * prefix.
 * La resta de l'aplicació (els feeds) és espai de treball i segueix l'idioma de la galeta.
 */
export function isPublicPath(path: string): boolean {
  return path === '/' || path === '/catalog' || path.startsWith('/catalog/');
}

/** Treu el prefix d'idioma: `/fr/catalog` → `{ locale: 'fr', path: '/catalog' }`. */
export function splitLocalePath(pathname: string): { locale: Locale | null; path: string } {
  const [, first, ...rest] = pathname.split('/');
  if (isLocale(first) && first !== DEFAULT_LOCALE) {
    return { locale: first, path: `/${rest.join('/')}`.replace(/\/$/, '') || '/' };
  }
  return { locale: null, path: pathname };
}

/** L'adreça pública d'una pàgina en un idioma. */
export function localizedPath(locale: Locale, path: string): string {
  if (locale === DEFAULT_LOCALE) return path;
  return path === '/' ? `/${locale}` : `/${locale}${path}`;
}

export const PREFIXED_LOCALES = LOCALES.filter((l) => l !== DEFAULT_LOCALE);
