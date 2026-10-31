import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from './config';

/**
 * Public pages (home and catalog) have one address per language so search engines can index each
 * version: `/ca/catalog`, `/fr/catalog`. English (`DEFAULT_LOCALE`) has no prefix.
 * The rest of the app (the feeds) is a workspace and follows the cookie language.
 */
export function isPublicPath(path: string): boolean {
  return path === '/' || path === '/catalog' || path.startsWith('/catalog/');
}

/** Strips the language prefix: `/fr/catalog` → `{ locale: 'fr', path: '/catalog' }`. */
export function splitLocalePath(pathname: string): { locale: Locale | null; path: string } {
  const [, first, ...rest] = pathname.split('/');
  if (isLocale(first) && first !== DEFAULT_LOCALE) {
    return { locale: first, path: `/${rest.join('/')}`.replace(/\/$/, '') || '/' };
  }
  return { locale: null, path: pathname };
}

/** The public address of a page in a language. */
export function localizedPath(locale: Locale, path: string): string {
  if (locale === DEFAULT_LOCALE) return path;
  return path === '/' ? `/${locale}` : `/${locale}${path}`;
}

export const PREFIXED_LOCALES = LOCALES.filter((l) => l !== DEFAULT_LOCALE);
