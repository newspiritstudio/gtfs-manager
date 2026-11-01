import { useParams } from 'react-router';
import CrumbLabel from '@/components/shell/CrumbLabel';
import { ListSkeleton } from '@/components/ui/Skeleton';
import PrintFrame from '@/features/print/PrintFrame';
import RoutePrintSheet from '@/features/print/RoutePrintSheet';
import { useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

/** Printable timetable of a route: `/feeds/:feedId/routes/:routeId/print`. */
export default function RoutePrintPage() {
  const feedId = useFeedId();
  const { routeId = '' } = useParams();
  const { t } = useI18n();
  useDocumentHead({ title: t('outputs.printTitle') });
  return (
    <PrintFrame feedId={feedId} backHref={`/feeds/${feedId}/routes/${encodeURIComponent(routeId)}`}>
      {(date, note) => <Sheet feedId={feedId} routeId={routeId} date={date} note={note} />}
    </PrintFrame>
  );
}

function Sheet({
  feedId,
  routeId,
  date,
  note,
}: {
  feedId: string;
  routeId: string;
  date: string;
  note: string;
}) {
  const print = useEngine('getRoutePrint', feedId, routeId, date);
  if (print.status === 'error') throw print.error;
  if (print.status === 'loading') return <ListSkeleton rows={6} />;
  if (!print.data) return null;
  return (
    <>
      <CrumbLabel label={print.data.route.shortName || print.data.route.longName || routeId} />
      <RoutePrintSheet data={print.data} note={note} />
    </>
  );
}
