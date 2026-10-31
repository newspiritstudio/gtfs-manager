import { motion as m } from 'motion/react';
import { Link, usePathname } from '@/lib/router';
import { useId } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { localizedPath, splitLocalePath } from '@/lib/i18n/paths';
import { SPRING } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { ShellFeed } from '@shared/contracts';
import BrandMark from './BrandMark';
import {
  activeFeedNav,
  CATALOG_ICON,
  FEED_NAV,
  FEEDS_ICON,
  feedIdFromPath,
  HOME_ICON,
} from './nav';

export type { ShellFeed };

function NavLink({
  href,
  active,
  icon: Icon,
  children,
  onNavigate,
  indicatorId,
}: {
  href: string;
  active: boolean;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  children: React.ReactNode;
  onNavigate?: () => void;
  /** Each navigation instance (bar and mobile drawer) animates its own indicator. */
  indicatorId: string;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className="relative flex items-center gap-2.5 rounded-full px-3 py-1.5 text-label-large text-on-surface state-layer state-layer-on-surface focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/70 min-h-11 md:min-h-9"
    >
      {active ? (
        <m.span
          layoutId={indicatorId}
          transition={SPRING.defaultSpatial}
          aria-hidden
          className="absolute inset-0 rounded-full bg-[var(--module-accent)]/15"
        />
      ) : null}
      <Icon
        size={20}
        className={cn(
          'relative shrink-0',
          active ? 'text-[var(--module-accent)]' : 'text-on-surface-variant'
        )}
      />
      <span className="relative min-w-0 break-words">{children}</span>
    </Link>
  );
}

/** The network's official logo or, if it has none, a dot in its colour. */
function FeedMark({ feed }: { feed: ShellFeed }) {
  if (feed.logo) {
    return <img src={feed.logo} alt="" className="size-5 shrink-0 object-contain" loading="lazy" />;
  }
  return (
    <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
      <span
        className={cn('size-3 rounded-full', !feed.color && 'bg-outline')}
        style={feed.color ? { backgroundColor: feed.color } : undefined}
      />
    </span>
  );
}

export function NavContent({ feeds, onNavigate }: { feeds: ShellFeed[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t, locale } = useI18n();
  const indicatorId = `sidenav-active-${useId()}`;
  const feedId = feedIdFromPath(pathname);
  const currentFeed = feedId ? feeds.find((f) => f.id === feedId) : null;
  const activeItem = feedId ? activeFeedNav(pathname, feedId) : null;
  const { path } = splitLocalePath(pathname);

  return (
    <nav aria-label={t('nav.main')} className="space-y-4 p-3">
      {currentFeed ? (
        <div className="space-y-1">
          <p
            className="truncate px-3 py-1 text-label-medium text-on-surface-variant"
            title={currentFeed.name}
          >
            {currentFeed.name}
          </p>
          <ul className="space-y-1">
            {FEED_NAV.map((item) => (
              <li key={item.key}>
                <NavLink
                  href={`/feeds/${currentFeed.id}${item.path}`}
                  active={activeItem?.key === item.key}
                  icon={item.icon}
                  onNavigate={onNavigate}
                  indicatorId={indicatorId}
                >
                  {t(`nav.${item.key}`)}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ul className="space-y-1">
        <li>
          <NavLink
            href={localizedPath(locale, '/')}
            active={path === '/'}
            icon={HOME_ICON}
            onNavigate={onNavigate}
            indicatorId={indicatorId}
          >
            {t('nav.home')}
          </NavLink>
        </li>
        <li>
          <NavLink
            href={localizedPath(locale, '/catalog')}
            active={path === '/catalog' || path.startsWith('/catalog/')}
            icon={CATALOG_ICON}
            onNavigate={onNavigate}
            indicatorId={indicatorId}
          >
            {t('nav.catalog')}
          </NavLink>
        </li>
      </ul>
      <div className="space-y-1">
        <p className="px-3 py-1 text-label-medium text-on-surface-variant">{t('nav.feeds')}</p>
        <ul className="space-y-1">
          <li>
            <NavLink
              href="/feeds"
              active={path === '/feeds'}
              icon={FEEDS_ICON}
              onNavigate={onNavigate}
              indicatorId={indicatorId}
            >
              {t('nav.allFeeds')}
            </NavLink>
          </li>
          {feeds
            .filter((f) => f.id !== currentFeed?.id)
            .slice(0, 8)
            .map((feed) => (
              <li key={feed.id}>
                <Link
                  href={`/feeds/${feed.id}`}
                  onClick={onNavigate}
                  className="flex min-h-11 items-center gap-2.5 rounded-full px-3 py-1.5 text-body-medium text-on-surface-variant state-layer state-layer-on-surface focus-ring md:min-h-9"
                >
                  <FeedMark feed={feed} />
                  <span className="truncate">{feed.name}</span>
                </Link>
              </li>
            ))}
        </ul>
      </div>
    </nav>
  );
}

export default function SideNav({ feeds }: { feeds: ShellFeed[] }) {
  return (
    <div className="hidden h-full w-56 shrink-0 flex-col overflow-y-auto md:flex xl:w-64">
      <div className="p-4">
        <BrandMark />
      </div>
      <div className="flex-1 overflow-y-auto">
        <NavContent feeds={feeds} />
      </div>
    </div>
  );
}
