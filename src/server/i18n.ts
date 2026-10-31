import { cookies, headers } from 'next/headers';
import ca from '@/locales/ca.json';
import en from '@/locales/en.json';
import es from '@/locales/es.json';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from '@/lib/i18n/config';
import { createTranslator, type Messages } from '@/lib/i18n/translate';

export const MESSAGES: Record<Locale, Messages> = { ca, es, en };

/** L'idioma de la petició: la galeta triada, o el primer idioma del navegador que tinguem. */
export async function getLocale(): Promise<Locale> {
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
