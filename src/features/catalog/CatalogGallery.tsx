import { Download, ExternalLink, Globe2 } from 'lucide-react';
import { Link, usePathname, useRouter, useSearchParams } from '@/lib/router';
import { useMemo, useState } from 'react';
import { CATALOG_LOGOS, type CatalogEntry } from '@shared/catalog';
import { transitModeForRouteType } from '@shared/gtfs-spec';
import Badge from '@/components/ui/Badge';
import ModeIcon from '@/components/ui/ModeIcon';
import { ButtonLink } from '@/components/ui/Button';
import SearchField from '@/components/ui/SearchField';
import MenuSelect from '@/components/ui/MenuSelect';
import { useI18n } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/paths';
import CountryFlag from './CountryFlag';
import CatalogStatusLine, { useCatalogStatuses } from './CatalogStatusLine';

export default function CatalogGallery({
  entries,
  imported,
}: {
  entries: CatalogEntry[];
  imported: Record<string, string>;
}) {
  const { t, locale } = useI18n();
  const { statuses, failed: statusFailed } = useCatalogStatuses();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // The filter lives in the URL: it can be shared and the back button undoes it.
  const country = params.get('country') ?? 'all';
  const [query, setQuery] = useState(params.get('q') ?? '');
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`);
  };

  const countryName = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale]);
  const countries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.country, (counts.get(e.country) ?? 0) + 1);
    return [...counts]
      .map(([code, count]) => ({ code, count, name: countryName.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [entries, countryName, locale]);
  const needle = query.trim().toLocaleLowerCase(locale);
  const visible = entries.filter(
    (e) =>
      (country === 'all' || e.country === country) &&
      (!needle ||
        [e.name, e.operator, e.region, countryName.of(e.country) ?? '']
          .join(' ')
          .toLocaleLowerCase(locale)
          .includes(needle))
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={query}
          onChange={(value) => {
            setQuery(value);
            setParam('q', value.trim());
          }}
          label={t('catalog.search')}
          placeholder={t('catalog.search')}
          className="w-full sm:w-96"
        />
        <div className="w-full sm:w-64">
          <MenuSelect
            label={t('catalog.country')}
            value={country}
            onChange={(next) => setParam('country', next)}
            options={[
              {
                value: 'all',
                label: t('catalog.allCountries'),
                icon: <Globe2 className="size-5 text-on-surface-variant" />,
                trailing: String(entries.length),
              },
              ...countries.map((c) => ({
                value: c.code,
                label: c.name,
                icon: <CountryFlag code={c.code} />,
                trailing: String(c.count),
              })),
            ]}
          />
        </div>
        <p className="text-body-medium text-on-surface-variant sm:ml-auto">
          {t('catalog.count', { count: visible.length })}
        </p>
      </div>
      {visible.length ? null : (
        <p className="rounded-lg bg-tonal p-6 text-center text-body-large text-on-surface-variant">
          {t('catalog.noResults')}
        </p>
      )}
      <ul className="grid gap-4 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
        {visible.map((entry) => {
          const status = statuses?.[entry.id];
          const modes = [...new Set(entry.routeTypes.map(transitModeForRouteType))];
          const feedId = imported[entry.id];
          return (
            <li key={entry.id} className="flex min-w-0 flex-col gap-3 rounded-lg bg-tonal p-4">
              <div className="flex items-start gap-3">
                {entry.logo ? (
                  // Logos are drawn on white, as brands use them, in the dark theme too.
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
                  <h2 className="text-title-medium text-on-surface">
                    <Link
                      href={localizedPath(locale, `/catalog/${entry.id}`)}
                      className="rounded-xs hover:underline focus-ring"
                    >
                      {entry.name}
                    </Link>
                  </h2>
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
              <CatalogStatusLine
                className="mt-auto"
                status={status}
                loading={!statuses}
                failed={statusFailed}
              />
              <div className="flex flex-wrap items-center gap-2">
                {feedId ? (
                  <>
                    <ButtonLink href={`/feeds/${feedId}`} variant="tonal">
                      {t('catalog.open')}
                      <span className="sr-only"> · {entry.name}</span>
                    </ButtonLink>
                    <ButtonLink href={`/new?catalog=${entry.id}`} variant="ghost">
                      {t('catalog.reimport')}
                      <span className="sr-only"> · {entry.name}</span>
                    </ButtonLink>
                  </>
                ) : (
                  <ButtonLink href={`/new?catalog=${entry.id}`} variant="tonal">
                    <Download />
                    {t('catalog.import')}
                    <span className="sr-only"> · {entry.name}</span>
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
                  <span className="sr-only"> · {entry.name}</span>
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

/** Where each logo comes from: the file name on Wikimedia Commons and the licence listed there. */
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
