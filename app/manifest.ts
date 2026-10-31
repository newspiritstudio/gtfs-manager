import type { MetadataRoute } from 'next';
import { getI18n } from '@/server/i18n';
import { SITE_NAME } from '@/server/seo';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { t } = await getI18n();
  return {
    name: SITE_NAME,
    short_name: 'GTFS',
    description: t('app.description'),
    start_url: '/feeds',
    display: 'standalone',
    background_color: '#f7f9ff',
    theme_color: '#1f4f86',
    categories: ['productivity', 'utilities', 'travel'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
