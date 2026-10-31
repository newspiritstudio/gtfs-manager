import type { Metadata } from 'next';
import LandingPage from './_landing/LandingPage';
import { getI18n } from '@/server/i18n';
import { publicMetadata } from '@/server/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getI18n();
  return publicMetadata({
    locale,
    path: '/',
    title: t('seo.homeTitle'),
    description: t('seo.homeDescription'),
    absoluteTitle: true,
  });
}

export default function HomePage() {
  return <LandingPage />;
}
