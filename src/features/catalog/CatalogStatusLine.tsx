import { CircleCheck, CircleDashed, CircleX } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CatalogStatus } from '@shared/catalog';
import { catalogStatuses } from '@/lib/catalog';
import { useI18n } from '@/lib/i18n/client';
import { formatNumber, formatRelative } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';

/** The status of the catalog sources, checked live (it may take a few seconds). */
export function useCatalogStatuses() {
  const [statuses, setStatuses] = useState<Record<string, CatalogStatus> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    catalogStatuses()
      .then((list) => alive && setStatuses(Object.fromEntries(list.map((s) => [s.id, s]))))
      // If the check fails we know nothing about the sources: do not mark them as down.
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  return { statuses, failed };
}

function formatSize(locale: string, bytes: number) {
  return `${formatNumber(locale, bytes / 1024 / 1024, { maximumFractionDigits: bytes < 10 * 1024 * 1024 ? 1 : 0 })} MB`;
}

export default function CatalogStatusLine({
  status,
  loading,
  failed,
  className,
}: {
  status: CatalogStatus | undefined;
  loading: boolean;
  failed: boolean;
  className?: string;
}) {
  const { t, locale } = useI18n();
  return (
    <p
      className={cn(
        'flex min-h-5 items-center gap-1.5 text-body-small text-on-surface-variant [&_svg]:size-4',
        className
      )}
    >
      {failed ? null : loading ? (
        <>
          <CircleDashed className="animate-spin text-on-surface-muted" /> {t('catalog.checking')}
        </>
      ) : status?.available ? (
        <>
          <CircleCheck className="text-success" />
          <span>
            {status.updatedAt
              ? t('catalog.updated', { when: formatRelative(locale, status.updatedAt) })
              : t('catalog.available')}
            {status.size ? ` · ${formatSize(locale, status.size)}` : ''}
          </span>
        </>
      ) : (
        <>
          <CircleX className="text-critical" /> {t('catalog.unavailable')}
        </>
      )}
    </p>
  );
}
