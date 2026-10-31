import type { Metadata } from 'next';
import { LOCALE_TAGS, LOCALES, OG_LOCALES, type Locale } from '@/lib/i18n/config';
import { localizedPath } from '@/lib/i18n/paths';

/** L'adreça pública de la instal·lació, per a les adreces absolutes (canònica, sitemap, Open Graph). */
export const SITE_URL = (process.env.SITE_URL || 'https://gtfs.newspirit.studio').replace(
  /\/$/,
  ''
);
export const SITE_NAME = 'GTFS Manager';

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path === '/' ? '' : path}` || SITE_URL;
}

/** Les versions d'una pàgina pública en cada idioma, per a `hreflang`. */
export function languageAlternates(path: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of LOCALES) languages[LOCALE_TAGS[locale]] = localizedPath(locale, path);
  // Sense prefix: l'anglès per als cercadors i, per a les persones, l'idioma del navegador.
  languages['x-default'] = path;
  return languages;
}

/** Metadades d'una pàgina pública indexable: canònica, alternatives d'idioma i targetes socials. */
export function publicMetadata({
  locale,
  path,
  title,
  description,
  absoluteTitle = false,
}: {
  locale: Locale;
  path: string;
  title: string;
  description: string;
  /** El títol ja porta la marca (la pàgina d'inici): no s'hi afegeix « · GTFS Manager». */
  absoluteTitle?: boolean;
}): Metadata {
  const url = localizedPath(locale, path);
  // Una pàgina que defineix `openGraph` amaga la imatge del fitxer `opengraph-image`: es repeteix.
  const image = { url: '/opengraph-image', width: 1200, height: 630, alt: SITE_NAME };
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: url, languages: languageAlternates(path) },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title,
      description,
      url,
      locale: OG_LOCALES[locale],
      alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALES[l]),
      images: [image],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  };
}

/** L'espai de treball (feeds, importació) no s'indexa: és contingut de cada instal·lació. */
export const PRIVATE_ROBOTS: Metadata['robots'] = { index: false, follow: false };
