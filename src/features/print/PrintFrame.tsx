import { Printer } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import Button from '@/components/ui/Button';
import DateStepper from '@/components/ui/DateStepper';
import TextField from '@/components/ui/TextField';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { Link } from '@/lib/router';
import { referenceDateFrom } from '@shared/gtfs-values';

/**
 * A printable page: the controls (date, note, print) on screen only and the sheet below. While it
 * is mounted the body says so, and `src/outputs.css` hides the app frame when printing.
 */
export default function PrintFrame({
  feedId,
  backHref,
  children,
}: {
  feedId: string;
  backHref: string;
  /** The sheet, from the chosen date and the note. */
  children: (date: string, note: string) => ReactNode;
}) {
  const { t } = useI18n();
  const stats = useEngine('ensureStats', feedId);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    document.body.dataset.printSheet = '';
    return () => {
      delete document.body.dataset.printSheet;
    };
  }, []);

  if (stats.status !== 'ready') return <ListSkeleton rows={6} />;
  const range = stats.data?.dateRange ?? null;
  const date = picked ?? referenceDateFrom(stats.data?.tripsByDate ?? []) ?? range?.start ?? '';
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div data-print-hide className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <DateStepper value={date} onChange={setPicked} min={range?.start} max={range?.end} />
          <TextField
            className="min-w-60"
            label={t('outputs.note')}
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button onClick={() => window.print()}>
            <Printer />
            {t('outputs.print')}
          </Button>
          <Link
            href={backHref}
            className="rounded-xs px-2 py-1 text-label-large text-primary hover:underline focus-ring"
          >
            {t('outputs.back')}
          </Link>
        </div>
        <p className="text-body-small text-on-surface-variant">{t('outputs.printHint')}</p>
      </div>
      <article className="print-sheet rounded-lg p-6 shadow-sm">
        {date ? children(date, note) : null}
      </article>
    </div>
  );
}
