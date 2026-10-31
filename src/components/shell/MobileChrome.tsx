import { Menu, MoreHorizontal, X } from 'lucide-react';
import { AnimatePresence, motion as m } from 'motion/react';
import { Link, usePathname } from '@/lib/router';
import { useEffect, useRef, useState } from 'react';
import IconButton from '@/components/ui/IconButton';
import { useI18n } from '@/lib/i18n/client';
import { SPRING } from '@/lib/motion';
import { cn } from '@/lib/utils';
import ExportButton from './ExportButton';
import BrandMark from './BrandMark';
import StudioByline from './StudioByline';
import { activeFeedNav, FEED_NAV, feedIdFromPath } from './nav';
import { LanguageSelect, ThemeToggle } from './Preferences';
import { NavContent, type ShellFeed } from './SideNav';
import { useBreadcrumbs } from './TopBar';

export function MobileHeader({ feeds }: { feeds: ShellFeed[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { crumbs, feedId } = useBreadcrumbs(feeds);
  const panelRef = useRef<HTMLDivElement>(null);
  // Escape closes the drawer; focus enters it on open and returns to the opener on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key !== 'Tab' || !panelRef.current) return;
      // The drawer is modal: Tab cannot leave it for the page behind.
      const items = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select, [tabindex]:not([tabindex="-1"])'
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open]);
  return (
    <>
      <header className="box-content flex h-14 shrink-0 items-center gap-2 bg-surface px-2 pt-[var(--safe-top,0px)] md:hidden">
        <IconButton label={t('nav.openMenu')} onClick={() => setOpen(true)}>
          <Menu />
        </IconButton>
        {/* The page already carries the title in its header: the bar gives context (the feed you
            are in) and does not repeat it. */}
        {feedId && crumbs.length > 2 ? (
          <Link
            href={crumbs[1].href}
            className="flex min-w-0 flex-1 items-center rounded-xs text-title-large text-on-surface focus-ring"
          >
            <span className="truncate">{crumbs[1].label}</span>
          </Link>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate text-title-medium text-on-surface">GTFS Manager</p>
            <StudioByline />
          </div>
        )}
        <ThemeToggle />
      </header>
      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-mobile-overlay md:hidden">
            <m.div
              className="absolute inset-0 bg-scrim/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <m.div
              ref={panelRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label={t('nav.main')}
              className="absolute inset-y-0 left-0 flex w-[min(320px,85vw)] outline-none flex-col overflow-y-auto rounded-r-xl bg-surface-container-low pt-[var(--safe-top,0px)]"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={SPRING.defaultSpatial}
            >
              <div className="flex items-center justify-between p-4">
                <BrandMark />
                <IconButton label={t('common.close')} onClick={() => setOpen(false)}>
                  <X />
                </IconButton>
              </div>
              <NavContent feeds={feeds} onNavigate={() => setOpen(false)} />
              <div className="mt-auto flex flex-wrap items-center gap-2 p-4">
                {feedId ? <ExportButton feedId={feedId} /> : null}
                <LanguageSelect />
              </div>
            </m.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

export function MobileNavigationBar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const feedId = feedIdFromPath(pathname);
  if (!feedId) return null;
  const active = activeFeedNav(pathname, feedId);
  const items = FEED_NAV.filter((i) => i.mobile);
  const moreActive = active && !active.mobile;
  return (
    <nav
      aria-label={t('nav.sections')}
      className="flex shrink-0 items-stretch justify-around bg-surface-container pb-[var(--safe-bottom,0px)] md:hidden"
    >
      {[...items, null].map((item) => {
        const isMore = item === null;
        const href = isMore ? `/feeds/${feedId}/validation` : `/feeds/${feedId}${item.path}`;
        const isActive = isMore ? Boolean(moreActive) : active?.key === item.key;
        const Icon = isMore ? MoreHorizontal : item.icon;
        return (
          <Link
            key={isMore ? 'more' : item.key}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className="flex h-16 flex-1 flex-col items-center justify-center gap-1 text-label-medium text-on-surface-variant focus-ring"
          >
            <span
              className={cn(
                'flex h-8 w-14 items-center justify-center rounded-full transition-colors',
                isActive ? 'bg-secondary-container text-on-secondary-container' : ''
              )}
            >
              <Icon className="size-5" />
            </span>
            <span className={isActive ? 'text-on-surface' : ''}>
              {t(isMore ? 'nav.more' : `nav.${item.key}`)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
