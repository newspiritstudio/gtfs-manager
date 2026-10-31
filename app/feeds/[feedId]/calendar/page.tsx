import type { Metadata } from 'next';
import { Suspense } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import CalendarView from '@/features/calendar/CalendarView';
import { getServices } from '@/server/gtfs/details';
import { ensureStats } from '@/server/gtfs/stats';
import { getI18n } from '@/server/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('nav.calendar') };
}

export default async function CalendarPage({ params }: { params: Promise<{ feedId: string }> }) {
  const { feedId } = await params;
  const { t } = await getI18n();
  const [stats, services] = await Promise.all([ensureStats(feedId), getServices(feedId)]);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('nav.calendar')} subtitle={t('calendar.subtitle')} />
      <Suspense>
        <CalendarView feedId={feedId} tripsByDate={stats?.tripsByDate ?? []} services={services} />
      </Suspense>
    </div>
  );
}
