'use client';

import { Languages, Monitor, Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import IconButton from '@/components/ui/IconButton';
import { useI18n } from '@/lib/i18n/client';
import { LOCALE_COOKIE, LOCALES, type Locale } from '@/lib/i18n/config';
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
  return (
    <label className="relative inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-label-large text-on-surface-variant state-layer focus-ring-within">
      <Languages aria-hidden className="size-5" />
      <span className="sr-only">{t('language.label')}</span>
      <select
        value={locale}
        onChange={(e) => {
          document.cookie = `${LOCALE_COOKIE}=${e.target.value as Locale}; path=/; max-age=31536000; samesite=lax`;
          router.refresh();
        }}
        className="cursor-pointer appearance-none bg-transparent text-label-large uppercase text-on-surface focus:outline-none"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {t(`language.${l}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
