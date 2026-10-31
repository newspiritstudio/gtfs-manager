import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { DEFAULT_LOCALE, isLocale, LOCALE_STORAGE_KEY, LOCALE_TAGS, type Locale } from './config';
import { isPublicPath, localizedPath, splitLocalePath } from './paths';
import { createTranslator, type Messages, type Translate } from './translate';

/** Each language is its own chunk: a visitor downloads theirs and Catalan, the fallback. */
const loaders = import.meta.glob<{ default: Messages }>('../../locales/*.json');

const cache = new Map<Locale, Messages>();

export async function loadMessages(locale: Locale): Promise<Messages> {
  const cached = cache.get(locale);
  if (cached) return cached;
  const { default: messages } = await loaders[`../../locales/${locale}.json`]();
  cache.set(locale, messages);
  return messages;
}

/** Loads a language and the Catalan fallback, so the first render already has its texts. */
export async function preloadLocale(locale: Locale): Promise<void> {
  await Promise.all([loadMessages(locale), loadMessages('ca')]);
}

function storedLocale(): Locale | null {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The language of a page: public pages carry it in the address (`/fr/catalog`; English has no
 * prefix); the workspace uses the one chosen, or else the first browser language we have.
 */
export function resolveLocale(pathname: string): Locale {
  const { locale, path } = splitLocalePath(pathname);
  if (isPublicPath(path)) return locale ?? DEFAULT_LOCALE;
  const stored = storedLocale();
  if (stored) return stored;
  for (const language of navigator.languages ?? []) {
    const code = language.slice(0, 2).toLowerCase();
    if (isLocale(code)) return code;
  }
  return DEFAULT_LOCALE;
}

interface I18nValue {
  locale: Locale;
  t: Translate;
  /** Remembers the language and shows the page in it (public pages move to its address). */
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState(0);
  // `chosen` only makes the language be read again after a choice.
  const wanted = useMemo(() => (void chosen, resolveLocale(pathname)), [pathname, chosen]);
  const [shown, setShown] = useState<Locale>(() => (cache.has(wanted) ? wanted : DEFAULT_LOCALE));

  useEffect(() => {
    let alive = true;
    preloadLocale(wanted).then(() => alive && setShown(wanted));
    return () => {
      alive = false;
    };
  }, [wanted]);

  useEffect(() => {
    document.documentElement.lang = LOCALE_TAGS[shown];
  }, [shown]);

  // Opening a page in a language (`/fr/catalog`) keeps that language for the rest of the app.
  useEffect(() => {
    const { locale } = splitLocalePath(pathname);
    if (!locale) return;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {}
  }, [pathname]);

  const setLocale = useCallback(
    (next: Locale) => {
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, next);
      } catch {}
      const { path } = splitLocalePath(pathname);
      if (isPublicPath(path)) navigate(localizedPath(next, path));
      setChosen((n) => n + 1);
    },
    [navigate, pathname]
  );

  const value = useMemo(
    () => ({
      locale: shown,
      t: createTranslator(shown, cache.get(shown) ?? {}, cache.get('ca') ?? {}),
      setLocale,
    }),
    [shown, setLocale]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n outside I18nProvider');
  return value;
}
