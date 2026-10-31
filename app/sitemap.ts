import type { MetadataRoute } from 'next';
import { GTFS_CATALOG } from '@shared/catalog';
import { LOCALES } from '@/lib/i18n/config';
import { localizedPath } from '@/lib/i18n/paths';
import { absoluteUrl, languageAlternates } from '@/server/seo';

/** Les pàgines públiques en tots els idiomes, cadascuna amb les seves alternatives (hreflang). */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: { path: string; priority: number }[] = [
    { path: '/', priority: 1 },
    { path: '/catalog', priority: 0.8 },
    ...GTFS_CATALOG.map((entry) => ({ path: `/catalog/${entry.id}`, priority: 0.6 })),
  ];
  return pages.flatMap(({ path, priority }) => {
    const languages = Object.fromEntries(
      Object.entries(languageAlternates(path)).map(([lang, href]) => [lang, absoluteUrl(href)])
    );
    return LOCALES.map((locale) => ({
      url: absoluteUrl(localizedPath(locale, path)),
      changeFrequency: path === '/' ? ('monthly' as const) : ('weekly' as const),
      priority,
      alternates: { languages },
    }));
  });
}
