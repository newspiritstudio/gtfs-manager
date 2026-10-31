import Loaded from '@/components/shell/Loaded';
import { CalendarSkeleton } from '@/components/skeletons/PageSkeletons';
import PageHeader from '@/components/ui/PageHeader';
import CalendarView from '@/features/calendar/CalendarView';
import { both, useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

export default function CalendarPage() {
  const feedId = useFeedId();
  const { t } = useI18n();
  useDocumentHead({ title: t('nav.calendar') });
  const state = both(useEngine('ensureStats', feedId), useEngine('getServices', feedId));
  return (
    <Loaded state={state} skeleton={<CalendarSkeleton />}>
      {([stats, services]) => (
        <div className="mx-auto max-w-7xl">
          <PageHeader title={t('nav.calendar')} subtitle={t('calendar.subtitle')} />
          <CalendarView
            feedId={feedId}
            tripsByDate={stats?.tripsByDate ?? []}
            services={services}
          />
        </div>
      )}
    </Loaded>
  );
}
