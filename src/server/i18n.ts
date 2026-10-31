import { cookies, headers } from 'next/headers';
import ca from '@/locales/ca.json';
import de from '@/locales/de.json';
import en from '@/locales/en.json';
import es from '@/locales/es.json';
import fr from '@/locales/fr.json';
import it from '@/locales/it.json';
import ja from '@/locales/ja.json';
import pt from '@/locales/pt.json';
import zh from '@/locales/zh.json';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from '@/lib/i18n/config';
import { createTranslator, type Messages } from '@/lib/i18n/translate';

export const MESSAGES: Record<Locale, Messages> = { ca, es, en, fr, de, it, pt, zh, ja };

/**
 * L'idioma de la petició: el de l'adreça (`/fr/...`, que el proxy passa en una capçalera), la
 * galeta triada o el primer idioma del navegador que tinguem.
 */
export async function getLocale(): Promise<Locale> {
  const fromPath = (await headers()).get('x-gtfs-locale');
  if (isLocale(fromPath)) return fromPath;
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) return cookie;
  const accept = (await headers()).get('accept-language') ?? '';
  for (const part of accept.split(',')) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isLocale(code)) return code;
  }
  return DEFAULT_LOCALE;
}

export async function getI18n() {
  const locale = await getLocale();
  return {
    locale,
    t: createTranslator(locale, MESSAGES[locale], MESSAGES.ca),
    messages: MESSAGES[locale],
  };
}
