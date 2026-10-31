import type { Metadata } from 'next';
import NetworkExplorer from '@/features/network/NetworkExplorer';
import { getI18n } from '@/server/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('nav.map') };
}

export default async function MapPage({ params }: { params: Promise<{ feedId: string }> }) {
  const { feedId } = await params;
  return <NetworkExplorer feedId={feedId} />;
}
