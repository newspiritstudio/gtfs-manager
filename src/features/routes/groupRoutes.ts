import type { NetworkRoute } from '@shared/contracts';

export interface RouteGroup {
  key: string;
  name: string;
  longName: string | null;
  color: string;
  textColor: string;
  routeType: number | null;
  routeIds: string[];
  trips: number;
}

/** The endpoints of the long name, unordered ("A - B" and "B - A" are the same line). */
function endpointsKey(longName: string | null): string {
  if (!longName) return '';
  return longName
    .split(/\s-|-\s/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');
}

/**
 * Groups the lines a traveller sees as one: same short name, colour and operator (many
 * agencies, like Renfe, publish one per direction or variant). The trip endpoints count too:
 * Renfe has a "C1" in every hub and they are not the same line.
 */
export function groupRoutes(routes: NetworkRoute[]): RouteGroup[] {
  const groups = new Map<string, RouteGroup>();
  for (const r of routes) {
    const name = r.shortName || r.longName || r.routeId;
    const key = r.shortName
      ? `${r.agencyId ?? ''}|${r.shortName}|${r.color}|${endpointsKey(r.longName)}`
      : `id|${r.routeId}`;
    const g = groups.get(key);
    if (g) {
      g.routeIds.push(r.routeId);
      g.trips += r.trips;
      if (!g.longName && r.longName) g.longName = r.longName;
    } else {
      groups.set(key, {
        key,
        name,
        longName: r.shortName ? r.longName : null,
        color: r.color,
        textColor: r.textColor,
        routeType: r.routeType,
        routeIds: [r.routeId],
        trips: r.trips,
      });
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      (a.routeType ?? 99) - (b.routeType ?? 99) ||
      a.name.localeCompare(b.name, undefined, { numeric: true })
  );
}

/**
 * Collapses groups that would render as identical chips (same label, background and text colour)
 * into one entry. The first group supplies the key, name and link target; route ids and trip
 * counts are merged. Use it wherever chips only say "these lines serve here"; keep `groupRoutes`
 * output where each entry must stay reachable on its own.
 */
export function dedupeRouteBadges(groups: RouteGroup[]): RouteGroup[] {
  const byLook = new Map<string, RouteGroup>();
  for (const g of groups) {
    const look = `${g.name}|${g.color}|${g.textColor}`;
    const first = byLook.get(look);
    if (first) {
      first.routeIds.push(...g.routeIds);
      first.trips += g.trips;
      if (!first.longName && g.longName) first.longName = g.longName;
    } else {
      byLook.set(look, { ...g, routeIds: [...g.routeIds] });
    }
  }
  return [...byLook.values()];
}

/** Keeps the first item per rendered chip look (label + colours), preserving order. */
export function uniqueConnections<
  T extends { routeId: string; shortName: string | null; color: string; textColor: string },
>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((c) => {
    const look = `${c.shortName ?? c.routeId}|${c.color}|${c.textColor}`;
    if (seen.has(look)) return false;
    seen.add(look);
    return true;
  });
}
