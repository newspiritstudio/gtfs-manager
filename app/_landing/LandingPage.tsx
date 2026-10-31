import {
  ArrowRight,
  ChevronDown,
  Download,
  FileUp,
  ListChecks,
  ListPlus,
  Map,
  PencilLine,
} from 'lucide-react';
import Link from 'next/link';
import { CATALOG_LOGOS, GTFS_CATALOG } from '@shared/catalog';
import { GTFS_SPEC, GTFS_TABLES } from '@shared/gtfs-spec';
import JsonLd from '@/components/seo/JsonLd';
import { ButtonLink } from '@/components/ui/Button';
import { LOCALE_TAGS, LOCALES } from '@/lib/i18n/config';
import { localizedPath } from '@/lib/i18n/paths';
import { getI18n } from '@/server/i18n';
import { absoluteUrl, SITE_NAME, SITE_URL } from '@/server/seo';
import NetworkAnimation from '@/features/landing/NetworkAnimation';

const FEATURES = [
  { key: 'import', icon: FileUp },
  { key: 'visualize', icon: Map },
  { key: 'edit', icon: PencilLine },
  { key: 'generate', icon: ListPlus },
  { key: 'validate', icon: ListChecks },
  { key: 'export', icon: Download },
] as const;
const FAQ = ['what', 'create', 'validate', 'large', 'data', 'export'] as const;

export default async function LandingPage() {
  const { t, locale } = await getI18n();
  const catalogHref = localizedPath(locale, '/catalog');
  // Una mostra del catàleg (els que tenen isotip); la resta, a la pàgina del catàleg.
  const withLogo = GTFS_CATALOG.filter((e) => e.logo).slice(0, 15);

  return (
    <div className="mx-auto max-w-6xl space-y-16 pb-12 md:space-y-20">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'WebSite',
              '@id': `${SITE_URL}/#website`,
              name: SITE_NAME,
              url: SITE_URL,
              inLanguage: LOCALES.map((l) => LOCALE_TAGS[l]),
            },
            {
              '@type': 'SoftwareApplication',
              name: SITE_NAME,
              url: absoluteUrl(localizedPath(locale, '/')),
              description: t('seo.homeDescription'),
              applicationCategory: 'BusinessApplication',
              operatingSystem: 'Web',
              inLanguage: LOCALE_TAGS[locale],
              featureList: FEATURES.map((f) => t(`landing.features.${f.key}.title`)),
            },
            {
              '@type': 'FAQPage',
              mainEntity: FAQ.map((q) => ({
                '@type': 'Question',
                name: t(`landing.faq.${q}.q`),
                acceptedAnswer: { '@type': 'Answer', text: t(`landing.faq.${q}.a`) },
              })),
            },
          ],
        }}
      />

      <section className="grid items-center gap-8 pt-4 md:pt-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h1 className="text-balance text-display-small text-on-surface md:text-display-medium">
            {t('landing.title')}
          </h1>
          <p className="mt-4 max-w-xl text-pretty text-body-large text-on-surface-variant">
            {t('landing.lead')}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/feeds" size="lg">
              {t('landing.openEditor')}
              <ArrowRight />
            </ButtonLink>
            <ButtonLink href="/new" size="lg" variant="tonal">
              <FileUp />
              {t('landing.importFeed')}
            </ButtonLink>
            <ButtonLink href={catalogHref} size="lg" variant="ghost">
              {t('catalog.browse')}
            </ButtonLink>
          </div>
        </div>
        <NetworkAnimation />
      </section>

      <section aria-labelledby="features-title">
        <h2
          id="features-title"
          className="text-headline-small text-on-surface md:text-headline-medium"
        >
          {t('landing.featuresTitle')}
        </h2>
        <ul className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ key, icon: Icon }) => (
            <li key={key} className="flex gap-3">
              <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h3 className="text-title-medium text-on-surface">
                  {t(`landing.features.${key}.title`)}
                </h3>
                <p className="mt-1 text-body-medium text-on-surface-variant">
                  {t(`landing.features.${key}.body`)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="catalog-title" className="rounded-2xl bg-tonal p-6 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-xl">
            <h2
              id="catalog-title"
              className="text-headline-small text-on-surface md:text-headline-medium"
            >
              {t('landing.catalogTitle')}
            </h2>
            <p className="mt-2 text-body-large text-on-surface-variant">
              {t('landing.catalogText')}
            </p>
          </div>
          <ButtonLink href={catalogHref} variant="tonal">
            {t('catalog.browse')}
            <ArrowRight />
          </ButtonLink>
        </div>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {withLogo.map((entry) => (
            <li key={entry.id}>
              <Link
                href={localizedPath(locale, `/catalog/${entry.id}`)}
                className="flex h-full items-center gap-3 rounded-md bg-surface p-3 state-layer state-layer-on-surface focus-ring"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-white p-1 ring-1 ring-outline-variant/40">
                  <img
                    src={CATALOG_LOGOS[entry.logo!].src}
                    alt=""
                    width={32}
                    height={32}
                    loading="lazy"
                    className="size-full object-contain"
                  />
                </span>
                <span className="min-w-0 text-label-large text-on-surface">{entry.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="files-title" className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <h2
            id="files-title"
            className="text-headline-small text-on-surface md:text-headline-medium"
          >
            {t('landing.filesTitle')}
          </h2>
          <p className="mt-2 text-body-large text-on-surface-variant">{t('landing.filesText')}</p>
        </div>
        <ul className="flex flex-wrap content-start gap-2">
          {GTFS_TABLES.map((table) => (
            <li
              key={table}
              className="inline-flex h-9 items-center rounded-sm bg-surface-container-highest px-3 font-mono text-label-large text-on-surface"
            >
              {GTFS_SPEC[table].file}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="faq-title">
        <h2 id="faq-title" className="text-headline-small text-on-surface md:text-headline-medium">
          {t('landing.faqTitle')}
        </h2>
        <div className="mt-6 space-y-2">
          {FAQ.map((q) => (
            <details key={q} className="group rounded-lg bg-tonal">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-5 py-4 text-title-medium text-on-surface state-layer state-layer-on-surface focus-ring [&::-webkit-details-marker]:hidden">
                <h3>{t(`landing.faq.${q}.q`)}</h3>
                <ChevronDown
                  aria-hidden
                  className="size-5 shrink-0 text-on-surface-variant transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="px-5 pb-5 text-body-large text-on-surface-variant">
                {t(`landing.faq.${q}.a`)}
              </p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
