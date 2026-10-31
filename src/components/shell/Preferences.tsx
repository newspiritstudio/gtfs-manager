'use client';

import { Languages, Monitor, Moon, Sun } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import IconButton from '@/components/ui/IconButton';
import { useI18n } from '@/lib/i18n/client';
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALE_TAGS, LOCALES, type Locale } from '@/lib/i18n/config';
import { isPublicPath, localizedPath, splitLocalePath } from '@/lib/i18n/paths';
import {
  applyTheme,
  readThemePreference,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '@/lib/theme';

const ORDER: ThemePreference[] = ['system', 'light', 'dark'];

export function ThemeToggle() {
  const { t } = useI18n();
  const [pref, setPref] = useState<ThemePreference>('system');
  useEffect(() => {
    // Sincronitza amb la preferència desada (només existeix al navegador).
    setPref(readThemePreference());
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (readThemePreference() === 'system') applyTheme('system');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
  const Icon = pref === 'dark' ? Moon : pref === 'light' ? Sun : Monitor;
  return (
    <IconButton
      label={t('theme.switch', { theme: t(`theme.${pref}`) })}
      onClick={() => {
        try {
          localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {}
        applyTheme(next);
        setPref(next);
      }}
    >
      <Icon />
    </IconButton>
  );
}

export function LanguageSelect() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  return (
    <label className="relative inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-label-large text-on-surface-variant state-layer has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--md-sys-color-secondary)]">
      <Languages aria-hidden className="size-5" />
      <span className="sr-only">{t('language.label')}</span>
      <select
        value={locale}
        onChange={(e) => {
          const next = e.target.value as Locale;
          document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
          // Les pàgines públiques tenen una adreça per idioma. Hi va amb una càrrega sencera: la
          // closca (i amb ella `<html lang>` i els textos) no es torna a pintar en una navegació
          // del client. La resta de pàgines es tornen a pintar amb la galeta nova.
          const { path } = splitLocalePath(pathname);
          if (isPublicPath(path)) window.location.assign(localizedPath(next, path));
          else router.refresh();
        }}
        className="cursor-pointer appearance-none bg-transparent text-label-large text-on-surface focus:outline-none [&>option]:bg-surface [&>option]:text-on-surface"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={LOCALE_TAGS[l]}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
