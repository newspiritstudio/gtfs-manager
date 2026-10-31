import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { LOCALE_NAMES, LOCALE_TAGS, LOCALES } from '@/lib/i18n/config';
import { localizedPath } from '@/lib/i18n/paths';
import { getI18n } from '@/server/i18n';

const GTFS_REFERENCE_URL = 'https://gtfs.org/documentation/schedule/reference/';
const COMMONS_URL = 'https://commons.wikimedia.org/';
const CIRCLE_FLAGS_URL = 'https://github.com/HatScripts/circle-flags';

type Credit = 'logos' | 'flags' | 'animation';

const linkClass =
  'inline-flex min-h-9 items-center rounded-xs underline decoration-outline-variant underline-offset-4 hover:text-on-surface hover:decoration-current focus-ring';

/**
 * Footer of the public pages: useful links, per-language versions as plain links (search engines
 * crawl them) and the credits that must be cited. `path` is the address without the language
 * prefix (`/`, `/catalog`, `/catalog/fgc`).
 */
export default async function PublicFooter({ path, credits }: { path: string; credits: Credit[] }) {
  const { t, locale } = await getI18n();
  return (
    <footer className="mt-16 space-y-4 border-t border-outline-variant pt-6 text-body-medium text-on-surface-variant">
      <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-4">
        <nav aria-label={t('footer.links')}>
          <ul className="flex flex-wrap gap-x-5">
            <li>
              <Link href="/feeds" className={linkClass}>
                {t('landing.openEditor')}
              </Link>
            </li>
            <li>
              <Link href="/new" className={linkClass}>
                {t('landing.importFeed')}
              </Link>
            </li>
            <li>
              <Link href={localizedPath(locale, '/catalog')} className={linkClass}>
                {t('nav.catalog')}
              </Link>
            </li>
            <li>
              <a href={GTFS_REFERENCE_URL} target="_blank" rel="noreferrer" className={linkClass}>
                {t('footer.gtfsReference')}
                <ExternalLink aria-hidden className="ml-1 size-3.5" />
              </a>
            </li>
          </ul>
        </nav>
        <nav aria-label={t('footer.languages')}>
          <ul className="flex flex-wrap gap-x-4">
            {LOCALES.map((l) => (
              <li key={l}>
                <Link
                  href={localizedPath(l, path)}
                  hrefLang={LOCALE_TAGS[l]}
                  lang={LOCALE_TAGS[l]}
                  aria-current={l === locale ? 'true' : undefined}
                  className={`${linkClass} ${l === locale ? 'font-medium text-on-surface' : ''}`}
                >
                  {LOCALE_NAMES[l]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <ul className="space-y-1 text-body-small">
        {credits.includes('animation') ? <li>{t('footer.creditAnimation')}</li> : null}
        {credits.includes('logos') ? (
          <li>
            {t('footer.creditLogos')}{' '}
            <a href={COMMONS_URL} target="_blank" rel="noreferrer" className="underline">
              Wikimedia Commons
            </a>
          </li>
        ) : null}
        {credits.includes('flags') ? (
          <li>
            {t('footer.creditFlags')}{' '}
            <a href={CIRCLE_FLAGS_URL} target="_blank" rel="noreferrer" className="underline">
              circle-flags
            </a>{' '}
            (MIT)
          </li>
        ) : null}
      </ul>
    </footer>
  );
}
