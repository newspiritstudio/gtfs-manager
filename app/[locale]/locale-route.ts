import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';

/**
 * Public pages with a language prefix (`/fr`, `/fr/catalog`...) render the same page as the
 * unprefixed ones: the proxy has already chosen the language. Only prefixes that are not
 * languages are rejected here.
 */
export async function assertLocale(params: Promise<{ locale: string }>) {
  const { locale } = await params;
  if (!isLocale(locale) || locale === DEFAULT_LOCALE) notFound();
}
