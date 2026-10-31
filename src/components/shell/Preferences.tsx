import { Languages, Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import IconButton from '@/components/ui/IconButton';
import { useI18n } from '@/lib/i18n/client';
import { LOCALE_NAMES, LOCALE_TAGS, LOCALES, type Locale } from '@/lib/i18n/config';
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
    // Sync with the stored preference (it only exists in the browser).
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
  const { t, locale, setLocale } = useI18n();
  return (
    <label className="relative inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-label-large text-on-surface-variant state-layer has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--md-sys-color-secondary)]">
      <Languages aria-hidden className="size-5" />
      <span className="sr-only">{t('language.label')}</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
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
