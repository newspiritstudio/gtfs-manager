import { Download, ExternalLink, Map, Route, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { CATALOG_LOGOS, catalogZipUrl, GTFS_CATALOG, type CatalogEntry } from '@shared/catalog';
import { transitModeForRouteType } from '@shared/gtfs-spec';
import JsonLd from '@/components/seo/JsonLd';
import Badge from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import ModeIcon from '@/components/ui/ModeIcon';
import PageHeader from '@/components/ui/PageHeader';
import { LOCALE_TAGS } from '@/lib/i18n/config';
import { localizedPath } from '@/lib/i18n/paths';
import { importedCatalogFeeds } from '@/server/gtfs/feeds';
import { getI18n } from '@/server/i18n';
import { absoluteUrl } from '@/server/seo';
import CatalogEntryStatus from '@/features/catalog/CatalogEntryStatus';

function LogoTile({ entry, size }: { entry: CatalogEntry; size: 'md' | 'lg' }) {
  const modes = [...new Set(entry.routeTypes.map(transitModeForRouteType))];
  const box = size === 'lg' ? 'size-16 p-2' : 'size-10 p-1';
  // Els isotips es dibuixen sobre blanc, com els fan servir les marques, també en tema fosc.
  return entry.logo ? (
    <span
      className={`flex shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-outline-variant/40 ${box}`}
    >
      <img src={CATALOG_LOGOS[entry.logo].src} alt="" className="size-full object-contain" />
    </span>
  ) : (
    <span
      className={`flex shrink-0 items-center justify-center rounded-md bg-primary-tint text-primary ${size === 'lg' ? 'size-16 icon-slot-6' : 'size-10 icon-slot-5'}`}
    >
      <ModeIcon mode={modes[0] ?? 'rail'} />
    </span>
  );
}

export default async function CatalogEntryPage({ entry }: { entry: CatalogEntry }) {
  const { t, locale } = await getI18n();
  const feedId = (await importedCatalogFeeds())[entry.id];
  const modes = [...new Set(entry.routeTypes.map(transitModeForRouteType))];
  const countryName = new Intl.DisplayNames([LOCALE_TAGS[locale]], { type: 'region' });
  const country = countryName.of(entry.country) ?? entry.country;
  const zipUrl = catalogZipUrl(entry.source);
  const url = absoluteUrl(localizedPath(locale, `/catalog/${entry.id}`));
  // Primer els del mateix país: és el que busca qui consulta aquest feed.
  const more = GTFS_CATALOG.filter((e) => e.id !== entry.id)
    .sort((a, b) => Number(b.country === entry.country) - Number(a.country === entry.country))
    .slice(0, 6);
  const what = [
    { key: 'map', icon: Map },
    { key: 'lines', icon: Route },
    { key: 'validate', icon: ShieldCheck },
  ] as const;

  return (
    <div className="mx-auto max-w-6xl">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Dataset',
              name: t('seo.catalogEntryTitle', { name: entry.name }),
              description: t('seo.catalogEntryDescription', {
                operator: entry.operator,
                region: entry.region,
              }),
              url,
              sameAs: entry.homepage,
              isAccessibleForFree: true,
              keywords: ['GTFS', 'GTFS Schedule', entry.name, entry.operator, entry.region],
              creator: { '@type': 'Organization', name: entry.operator },
              spatialCoverage: { '@type': 'Place', name: `${entry.region}, ${country}` },
              ...(zipUrl
                ? {
                    distribution: {
                      '@type': 'DataDownload',
                      encodingFormat: 'application/zip',
                      contentUrl: zipUrl,
                    },
                  }
                : {}),
            },
            {
              '@type': 'BreadcrumbList',
              itemListElement: [
                {
                  '@type': 'ListItem',
                  position: 1,
                  name: t('catalog.title'),
                  item: absoluteUrl(localizedPath(locale, '/catalog')),
                },
                { '@type': 'ListItem', position: 2, name: entry.name, item: url },
              ],
            },
          ],
        }}
      />
      <PageHeader
        leading={<LogoTile entry={entry} size="lg" />}
        title={t('seo.catalogEntryTitle', { name: entry.name })}
        subtitle={entry.operator}
        actions={
          feedId ? (
            <>
              <ButtonLink href={`/feeds/${feedId}`}>{t('catalog.open')}</ButtonLink>
              <ButtonLink href={`/new?catalog=${entry.id}`} variant="tonal">
                {t('catalog.reimport')}
              </ButtonLink>
            </>
          ) : (
            <ButtonLink href={`/new?catalog=${entry.id}`}>
              <Download />
              {t('catalog.import')}
            </ButtonLink>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <section className="rounded-lg bg-tonal p-5">
            <p className="text-body-large text-on-surface">
              {t('catalogEntry.intro', { operator: entry.operator })}
            </p>
            <h2 className="mt-6 text-title-medium text-on-surface">{t('catalogEntry.details')}</h2>
            <dl className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="text-label-medium text-on-surface-variant">
                  {t('catalogEntry.operator')}
                </dt>
                <dd className="mt-1 text-body-large text-on-surface">{entry.operator}</dd>
              </div>
              <div>
                <dt className="text-label-medium text-on-surface-variant">
                  {t('catalogEntry.area')}
                </dt>
                <dd className="mt-1 text-body-large text-on-surface">
                  {[...new Set([entry.region, country])].join(' · ')}
                </dd>
              </div>
              <div>
                <dt className="text-label-medium text-on-surface-variant">
                  {t('catalogEntry.modes')}
                </dt>
                <dd className="mt-1.5">
                  <ul className="flex flex-wrap gap-1.5">
                    {modes.map((mode) => (
                      <li key={mode}>
                        <Badge icon={<ModeIcon mode={mode} />}>{t(`modes.${mode}`)}</Badge>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt className="text-label-medium text-on-surface-variant">
                  {t('catalogEntry.status')}
                </dt>
                <dd className="mt-1.5">
                  <CatalogEntryStatus id={entry.id} />
                </dd>
              </div>
            </dl>
            <div className="mt-6 flex flex-wrap gap-2">
              <ButtonLink href={entry.homepage} variant="tonal" target="_blank" rel="noreferrer">
                {t('catalogEntry.officialSource')}
                <ExternalLink />
              </ButtonLink>
              {zipUrl ? (
                <ButtonLink href={zipUrl} variant="ghost" rel="noreferrer">
                  <Download />
                  {t('catalogEntry.download')}
                </ButtonLink>
              ) : null}
            </div>
          </section>

          <section>
            <h2 className="text-title-large text-on-surface">{t('catalogEntry.whatTitle')}</h2>
            <ul className="mt-3 space-y-2">
              {what.map(({ key, icon: Icon }) => (
                <li
                  key={key}
                  className="flex items-center gap-3 rounded-md bg-surface-container-low p-3 text-body-large text-on-surface"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-primary-tint text-primary icon-slot-5">
                    <Icon />
                  </span>
                  {t(`catalogEntry.what.${key}`)}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside aria-labelledby="more-feeds">
          <h2 id="more-feeds" className="text-title-large text-on-surface">
            {t('catalogEntry.moreTitle')}
          </h2>
          <ul className="mt-3 space-y-2">
            {more.map((e) => (
              <li key={e.id}>
                <Link
                  href={localizedPath(locale, `/catalog/${e.id}`)}
                  className="flex items-center gap-3 rounded-md bg-tonal p-3 state-layer state-layer-on-surface focus-ring"
                >
                  <LogoTile entry={e} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate text-title-small text-on-surface">
                      {e.name}
                    </span>
                    <span className="block truncate text-body-small text-on-surface-variant">
                      {[...new Set([e.region, countryName.of(e.country) ?? e.country])].join(' · ')}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <ButtonLink href={localizedPath(locale, '/catalog')} variant="ghost" className="mt-3">
            {t('catalog.browse')}
          </ButtonLink>
        </aside>
      </div>
    </div>
  );
}
