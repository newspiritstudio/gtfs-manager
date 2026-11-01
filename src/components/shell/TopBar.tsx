import { ChevronRight } from 'lucide-react';
import { Link, usePathname } from '@/lib/router';
import { GTFS_CATALOG } from '@shared/catalog';
import { useI18n } from '@/lib/i18n/client';
import { splitLocalePath } from '@/lib/i18n/paths';
import { useCrumbLabel } from './CrumbLabel';
import { activeFeedNav, feedIdFromPath } from './nav';
import ExportButton from './ExportButton';
import { LanguageSelect, ThemeToggle } from './Preferences';
import type { ShellFeed } from './SideNav';

export function useBreadcrumbs(feeds: ShellFeed[]) {
  const pathname = usePathname();
  const { t } = useI18n();
  const detail = useCrumbLabel(pathname);
  const { path } = splitLocalePath(pathname);
  const crumbs: { label: string; href: string }[] = [];
  const feedId = feedIdFromPath(path);
  if (path === '/') {
    crumbs.push({ label: t('nav.home'), href: pathname });
  } else if (path === '/catalog' || path.startsWith('/catalog/')) {
    const base = pathname.slice(0, pathname.length - path.length) + '/catalog';
    crumbs.push({ label: t('nav.catalog'), href: base });
    const entry = GTFS_CATALOG.find((e) => `/catalog/${e.id}` === path);
    if (entry) crumbs.push({ label: entry.name, href: pathname });
  } else {
    crumbs.push({ label: t('nav.feeds'), href: '/feeds' });
    if (feedId) {
      const feed = feeds.find((f) => f.id === feedId);
      crumbs.push({ label: feed?.name ?? '…', href: `/feeds/${feedId}` });
      const item = activeFeedNav(pathname, feedId);
      if (item && item.path) {
        crumbs.push({ label: t(`nav.${item.key}`), href: `/feeds/${feedId}${item.path}` });
        const rest = pathname
          .slice(`/feeds/${feedId}${item.path}`.length)
          .split('/')
          .filter(Boolean);
        if (rest.length)
          crumbs.push({ label: detail?.label ?? decodeURIComponent(rest[0]), href: pathname });
      } else if (pathname.startsWith(`/feeds/${feedId}/compare`)) {
        crumbs.push({ label: t('compare.title'), href: pathname });
      } else if (pathname.startsWith(`/feeds/${feedId}/trips/`)) {
        // Trips are not in the navigation: they hang off the line that runs them.
        crumbs.push({ label: t('nav.routes'), href: `/feeds/${feedId}/routes` });
        if (detail?.parent) crumbs.push(detail.parent);
        crumbs.push({
          label: detail?.label ?? decodeURIComponent(pathname.split('/').pop() ?? ''),
          href: pathname,
        });
      }
    } else if (pathname === '/new') {
      crumbs.push({ label: t('feeds.new'), href: '/new' });
    }
  }
  return { crumbs, feedId };
}

export default function TopBar({ feeds }: { feeds: ShellFeed[] }) {
  const { t } = useI18n();
  const { crumbs, feedId } = useBreadcrumbs(feeds);
  return (
    <div className="hidden h-14 shrink-0 items-center gap-3 pl-2 pr-4 md:flex">
      <nav aria-label={t('nav.breadcrumbs')} className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1 text-label-large">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={c.href + i} className="flex min-w-0 items-center gap-1">
                {i > 0 ? (
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-on-surface-muted" />
                ) : null}
                {last ? (
                  <span aria-current="page" className="truncate px-1 text-on-surface">
                    {c.label}
                  </span>
                ) : (
                  // Links have the minimum height of any target (36 px): centring their text keeps them on the
                  // same line as the rule and the text of the current page.
                  <Link
                    href={c.href}
                    className="flex h-9 min-w-0 items-center rounded-xs px-1 text-on-surface-variant transition-colors hover:text-on-surface focus-ring"
                  >
                    <span className="truncate">{c.label}</span>
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="flex items-center gap-1">
        {feedId ? <ExportButton feedId={feedId} /> : null}
        <LanguageSelect />
        <ThemeToggle />
      </div>
    </div>
  );
}
