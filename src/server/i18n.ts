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
 * The request locale: the one in the URL (`/fr/...`, which the proxy passes in a header), the
 * chosen cookie or the first browser language we support.
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

/** Only the Catalan keys missing from a locale: what the client needs as a fallback. */
function missingFrom(messages: Messages, locale: Messages): Messages {
  const out: Messages = {};
  for (const [key, value] of Object.entries(messages)) {
    const have = locale[key];
    if (typeof value === 'string') {
      if (typeof have !== 'string') out[key] = value;
    } else {
      const nested = missingFrom(value, typeof have === 'object' ? have : {});
      if (Object.keys(nested).length) out[key] = nested;
    }
  }
  return out;
}

const fallbacks = new Map<Locale, Messages>();

/** The Catalan fallback sent to the browser: empty when the locale already has everything. */
export function clientFallback(locale: Locale): Messages {
  if (locale === 'ca') return {};
  let fallback = fallbacks.get(locale);
  if (!fallback) {
    fallback = missingFrom(MESSAGES.ca, MESSAGES[locale]);
    fallbacks.set(locale, fallback);
  }
  return fallback;
}

export async function getI18n() {
  const locale = await getLocale();
  return {
    locale,
    t: createTranslator(locale, MESSAGES[locale], MESSAGES.ca),
    messages: MESSAGES[locale],
  };
}
