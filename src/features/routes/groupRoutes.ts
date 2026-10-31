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

/** Els extrems del nom llarg sense ordre («A - B» i «B - A» són la mateixa línia). */
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
 * Agrupa les línies que el viatger veu com una de sola: mateix nom curt, color i operador (moltes
 * agències, com Renfe, en fan una per sentit o per variant). Els extrems del recorregut també
 * compten: Renfe té una «C1» a cada nucli i no són la mateixa línia.
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
