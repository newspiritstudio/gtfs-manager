import { useParams } from 'react-router';
import CrumbLabel from '@/components/shell/CrumbLabel';
import { ListSkeleton } from '@/components/ui/Skeleton';
import PrintFrame from '@/features/print/PrintFrame';
import StopPrintSheet from '@/features/print/StopPrintSheet';
import { useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

/** Printable departures of a stop: `/feeds/:feedId/stops/:stopId/print`. */
export default function StopPrintPage() {
  const feedId = useFeedId();
  const { stopId = '' } = useParams();
  const { t } = useI18n();
  useDocumentHead({ title: t('outputs.printTitle') });
  return (
    <PrintFrame feedId={feedId} backHref={`/feeds/${feedId}/stops/${encodeURIComponent(stopId)}`}>
      {(date, note) => <Sheet feedId={feedId} stopId={stopId} date={date} note={note} />}
    </PrintFrame>
  );
}

function Sheet({
  feedId,
  stopId,
  date,
  note,
}: {
  feedId: string;
  stopId: string;
  date: string;
  note: string;
}) {
  const print = useEngine('getStopPrint', feedId, stopId, date);
  if (print.status === 'error') throw print.error;
  if (print.status === 'loading') return <ListSkeleton rows={6} />;
  if (!print.data) return null;
  return (
    <>
      <CrumbLabel label={print.data.stop.name ?? stopId} />
      <StopPrintSheet data={print.data} note={note} />
    </>
  );
}
