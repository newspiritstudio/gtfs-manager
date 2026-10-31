import type { Metadata } from 'next';
import RealtimeView from '@/features/realtime/RealtimeView';
import { getI18n } from '@/server/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('nav.realtime') };
}

export default async function RealtimePage({ params }: { params: Promise<{ feedId: string }> }) {
  const { feedId } = await params;
  return <RealtimeView feedId={feedId} />;
}
