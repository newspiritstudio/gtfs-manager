import type { Metadata } from 'next';
import { LOCALE_TAGS, LOCALES, OG_LOCALES, type Locale } from '@/lib/i18n/config';
import { localizedPath } from '@/lib/i18n/paths';

/** The public URL of the installation, for absolute URLs (canonical, sitemap, Open Graph). */
export const SITE_URL = (process.env.SITE_URL || 'https://gtfs.newspirit.studio').replace(
  /\/$/,
  ''
);
export const SITE_NAME = 'GTFS Manager';

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path === '/' ? '' : path}` || SITE_URL;
}

/** The versions of a public page in each locale, for `hreflang`. */
export function languageAlternates(path: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of LOCALES) languages[LOCALE_TAGS[locale]] = localizedPath(locale, path);
  // Without a prefix: English for search engines and, for people, the browser language.
  languages['x-default'] = path;
  return languages;
}

/** Metadata of an indexable public page: canonical, language alternates and social cards. */
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
  /** The title already carries the brand (home page): do not append ' · GTFS Manager'. */
  absoluteTitle?: boolean;
}): Metadata {
  const url = localizedPath(locale, path);
  // A page that defines `openGraph` hides the `opengraph-image` file image, so repeat it.
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

/** The workspace (feeds, import) is not indexed: it is each installation's own content. */
export const PRIVATE_ROBOTS: Metadata['robots'] = { index: false, follow: false };
