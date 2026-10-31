'use client';

import { CircleCheck, CircleDashed, CircleX, Download, ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CATALOG_LOGOS, type CatalogEntry, type CatalogStatus } from '@shared/catalog';
import { transitModeForRouteType } from '@shared/gtfs-spec';
import Badge from '@/components/ui/Badge';
import ModeIcon from '@/components/ui/ModeIcon';
import { ButtonLink } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/Tabs';
import { apiFetch } from '@/lib/api';
import { formatNumber, formatRelative } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';

function formatSize(locale: string, bytes: number) {
  return `${formatNumber(locale, bytes / 1024 / 1024, { maximumFractionDigits: bytes < 10 * 1024 * 1024 ? 1 : 0 })} MB`;
}

export default function CatalogGallery({
  entries,
  imported,
}: {
  entries: CatalogEntry[];
  imported: Record<string, string>;
}) {
  const { t, locale } = useI18n();
  const [statuses, setStatuses] = useState<Record<string, CatalogStatus> | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [country, setCountry] = useState('all');

  useEffect(() => {
    let alive = true;
    apiFetch<CatalogStatus[]>('/api/catalog')
      .then((list) => alive && setStatuses(Object.fromEntries(list.map((s) => [s.id, s]))))
      // Si la comprovació falla no sabem res de les fonts: no les marquem com a caigudes.
      .catch(() => alive && setStatusFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const countryName = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale]);
  const countries = useMemo(
    () =>
      [...new Set(entries.map((e) => e.country))].sort((a, b) =>
        (countryName.of(a) ?? a).localeCompare(countryName.of(b) ?? b, locale)
      ),
    [entries, countryName, locale]
  );
  const visible = country === 'all' ? entries : entries.filter((e) => e.country === country);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label={t('catalog.title')}
          value={country}
          onChange={setCountry}
          options={[
            { value: 'all', label: t('catalog.all') },
            ...countries.map((c) => ({ value: c, label: countryName.of(c) ?? c })),
          ]}
        />
        <p className="text-body-medium text-on-surface-variant">
          {t('catalog.count', { count: visible.length })}
        </p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((entry) => {
          const status = statuses?.[entry.id];
          const modes = [...new Set(entry.routeTypes.map(transitModeForRouteType))];
          const feedId = imported[entry.id];
          return (
            <li key={entry.id} className="flex min-w-0 flex-col gap-3 rounded-lg bg-tonal p-4">
              <div className="flex items-start gap-3">
                {entry.logo ? (
                  // Els isotips es dibuixen sobre blanc, com els fan servir les marques, també en tema fosc.
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-white p-1.5 ring-1 ring-outline-variant/40">
                    <img
                      src={CATALOG_LOGOS[entry.logo].src}
                      alt=""
                      className="size-full object-contain"
                    />
                  </span>
                ) : (
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-primary-tint text-primary icon-slot-6">
                    <ModeIcon mode={modes[0] ?? 'rail'} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="text-title-medium text-on-surface">{entry.name}</h2>
                  {entry.operator !== entry.name ? (
                    <p className="truncate text-body-small text-on-surface-variant">
                      {entry.operator}
                    </p>
                  ) : null}
                </div>
                {feedId ? <Badge tone="success">{t('catalog.imported')}</Badge> : null}
              </div>
              <p className="text-body-medium text-on-surface-variant">
                {[...new Set([entry.region, countryName.of(entry.country) ?? entry.country])].join(
                  ' · '
                )}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {modes.map((mode) => (
                  <li key={mode}>
                    <Badge icon={<ModeIcon mode={mode} />}>{t(`modes.${mode}`)}</Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-auto flex min-h-5 items-center gap-1.5 text-body-small text-on-surface-variant [&_svg]:size-4">
                {statusFailed ? null : !statuses ? (
                  <>
                    <CircleDashed className="animate-spin text-on-surface-muted" />{' '}
                    {t('catalog.checking')}
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
              <div className="flex flex-wrap items-center gap-2">
                {feedId ? (
                  <>
                    <ButtonLink href={`/feeds/${feedId}`} variant="tonal">
                      {t('catalog.open')}
                    </ButtonLink>
                    <ButtonLink href={`/new?catalog=${entry.id}`} variant="ghost">
                      {t('catalog.reimport')}
                    </ButtonLink>
                  </>
                ) : (
                  <ButtonLink href={`/new?catalog=${entry.id}`} variant="tonal">
                    <Download />
                    {t('catalog.import')}
                  </ButtonLink>
                )}
                <ButtonLink
                  href={entry.homepage}
                  variant="ghost"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto"
                >
                  {t('catalog.source')}
                  <ExternalLink />
                </ButtonLink>
              </div>
            </li>
          );
        })}
      </ul>
      <LogoCredits entries={visible} />
    </div>
  );
}

/** D'on surt cada isotip: el nom del fitxer a Wikimedia Commons i la llicència que hi consta. */
function LogoCredits({ entries }: { entries: CatalogEntry[] }) {
  const { t } = useI18n();
  const ids = [...new Set(entries.flatMap((e) => (e.logo ? [e.logo] : [])))];
  if (!ids.length) return null;
  return (
    <p className="text-body-small text-on-surface-variant">
      {t('catalog.logosCredit')}{' '}
      {ids.map((id, i) => {
        const logo = CATALOG_LOGOS[id];
        return (
          <span key={id}>
            {i > 0 ? ' · ' : null}
            <a
              href={logo.url}
              target="_blank"
              rel="noreferrer"
              className="target-compact underline decoration-outline-variant underline-offset-2 hover:text-on-surface focus-ring"
            >
              {logo.file}
            </a>{' '}
            ({t(`catalog.license.${logo.license}`)})
          </span>
        );
      })}
      .
    </p>
  );
}
