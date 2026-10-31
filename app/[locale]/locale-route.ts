import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';

/**
 * Les pàgines públiques amb prefix d'idioma (`/fr`, `/fr/catalog`...) pinten la mateixa pàgina que
 * sense prefix: el proxy ja ha triat l'idioma. Aquí només es rebutgen els prefixos que no ho són.
 */
export async function assertLocale(params: Promise<{ locale: string }>) {
  const { locale } = await params;
  if (!isLocale(locale) || locale === DEFAULT_LOCALE) notFound();
}
