import L from 'leaflet';
import { useCallback, useMemo } from 'react';
import type { CompareMapData } from '@shared/compare';
import { formatDistance } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import { useResolvedTheme } from '@/lib/useResolvedTheme';
import BaseMap from './BaseMap';
import { escapeHtml } from './colors';

/** Status colours: also told apart by shape (filled dot, hollow ring, arrow line), never by colour alone. */
export const COMPARE_COLORS = {
  light: { added: '#1b7a3d', removed: '#ba1a1a', moved: '#b25a00' },
  dark: { added: '#58c27d', removed: '#ff8a80', moved: '#ffb257' },
};

/** The stops that differ between two feeds: added, removed, and moved with a line from old to new. */
export default function CompareMap({ data, label }: { data: CompareMapData; label: string }) {
  const { t, locale } = useI18n();
  const theme = useResolvedTheme();
  const colors = COMPARE_COLORS[theme === 'dark' ? 'dark' : 'light'];

  const bounds = useMemo((): [number, number, number, number] | null => {
    const points: [number, number][] = [
      ...data.added.map((s): [number, number] => [s.lat, s.lon]),
      ...data.removed.map((s): [number, number] => [s.lat, s.lon]),
      ...data.moved.flatMap((s) => [s.from, s.to]),
    ];
    if (!points.length) return null;
    let [s, w, n, e] = [90, 180, -90, -180];
    for (const [lat, lon] of points) {
      s = Math.min(s, lat);
      n = Math.max(n, lat);
      w = Math.min(w, lon);
      e = Math.max(e, lon);
    }
    return [s, w, n, e];
  }, [data]);

  const onReady = useCallback(
    (map: L.Map) => {
      const group = L.layerGroup().addTo(map);
      const tip = (name: string | null, id: string, extra: string) =>
        `<strong>${escapeHtml(name ?? id)}</strong><br>${escapeHtml(id)}${extra}`;
      for (const s of data.removed) {
        L.circleMarker([s.lat, s.lon], {
          radius: 6,
          color: colors.removed,
          weight: 2.5,
          fillOpacity: 0,
        })
          .bindTooltip(tip(s.name, s.stopId, `<br>${escapeHtml(t('compare.status.removed'))}`))
          .addTo(group);
      }
      for (const s of data.moved) {
        L.polyline([s.from, s.to], { color: colors.moved, weight: 2, dashArray: '4 3' }).addTo(
          group
        );
        L.circleMarker(s.from, {
          radius: 3,
          color: colors.moved,
          weight: 1.5,
          fillOpacity: 0,
        }).addTo(group);
        L.circleMarker(s.to, {
          radius: 5,
          color: colors.moved,
          weight: 1.5,
          fillColor: colors.moved,
          fillOpacity: 0.9,
        })
          .bindTooltip(
            tip(
              s.name,
              s.stopId,
              `<br>${escapeHtml(t('compare.moved', { distance: formatDistance(locale, s.meters) }))}`
            )
          )
          .addTo(group);
      }
      for (const s of data.added) {
        L.circleMarker([s.lat, s.lon], {
          radius: 5,
          color: colors.added,
          weight: 1.5,
          fillColor: colors.added,
          fillOpacity: 0.9,
        })
          .bindTooltip(tip(s.name, s.stopId, `<br>${escapeHtml(t('compare.status.added'))}`))
          .addTo(group);
      }
      return () => {
        group.remove();
      };
    },
    [data, colors, t, locale]
  );

  return (
    <BaseMap
      key={`${theme}:${data.added.length}:${data.moved.length}`}
      label={label}
      bounds={bounds}
      onReady={onReady}
      className="h-[28rem]"
      scrollZoom
    />
  );
}
