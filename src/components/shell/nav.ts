import {
  CalendarDays,
  Database,
  History,
  House,
  LayoutDashboard,
  Library,
  Map,
  MapPin,
  Radio,
  Route,
  ShieldCheck,
  Table2,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';

export interface FeedNavItem {
  key: string;
  /** Relative path inside the feed ('' is the overview). */
  path: string;
  icon: LucideIcon;
  mobile?: boolean;
}

export const FEED_NAV: FeedNavItem[] = [
  { key: 'overview', path: '', icon: LayoutDashboard, mobile: true },
  { key: 'map', path: '/map', icon: Map, mobile: true },
  { key: 'routes', path: '/routes', icon: Route, mobile: true },
  { key: 'stops', path: '/stops', icon: MapPin, mobile: true },
  { key: 'calendar', path: '/calendar', icon: CalendarDays },
  { key: 'validation', path: '/validation', icon: ShieldCheck },
  { key: 'realtime', path: '/realtime', icon: Radio },
  { key: 'data', path: '/data', icon: Table2 },
  { key: 'generator', path: '/generator', icon: WandSparkles },
  { key: 'history', path: '/history', icon: History },
];

export const HOME_ICON = House;
export const FEEDS_ICON = Database;
export const CATALOG_ICON = Library;

export function feedIdFromPath(pathname: string): string | null {
  const match = /^\/feeds\/([0-9a-f-]{36})/i.exec(pathname);
  return match ? match[1] : null;
}

/** The active feed section: the one with the longest matching path. */
export function activeFeedNav(pathname: string, feedId: string): FeedNavItem | null {
  const rest = pathname.slice(`/feeds/${feedId}`.length) || '';
  let best: FeedNavItem | null = null;
  for (const item of FEED_NAV) {
    const match =
      item.path === ''
        ? rest === '' || rest === '/'
        : rest === item.path || rest.startsWith(`${item.path}/`);
    if (match && (!best || item.path.length > best.path.length)) best = item;
  }
  return best;
}
