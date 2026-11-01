import L from 'leaflet';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServiceMapData } from '@shared/outputs';
import { formatNumber } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import { useResolvedTheme } from '@/lib/useResolvedTheme';
import BaseMap from './BaseMap';
import { escapeHtml } from './colors';
import { COVERAGE_COLOR, FREQUENCY_RAMP, FREQUENCY_WEIGHTS, frequencyBin } from './serviceScale';

/**
 * Frequency (segments coloured by trips per hour) or coverage (the walking radius around every
 * stop that has service). The map is recreated when the data, mode or theme change.
 */
export default function ServiceMap({
  data,
  mode,
  radius,
  label,
  insetLeft = 0,
}: {
  data: ServiceMapData;
  mode: 'frequency' | 'coverage';
  /** Walking radius in metres (coverage). */
  radius: number;
  label: string;
  insetLeft?: number;
}) {
  const { t, locale } = useI18n();
  const theme = useResolvedTheme() === 'dark' ? 'dark' : 'light';

  const [map, setMap] = useState<L.Map | null>(null);
  // One canvas renderer per layer kind and map: a new one on every redraw would leave a canvas behind.
  const renderers = useRef<{ lines: L.Canvas; area: L.Canvas } | null>(null);
  const onReady = useCallback((m: L.Map) => {
    // The coverage pane carries the opacity, so overlapping circles read as one served area.
    const pane = m.getPane('coverage') ?? m.createPane('coverage');
    pane.style.opacity = '0.35';
    pane.style.zIndex = '350';
    renderers.current = {
      lines: L.canvas({ padding: 0.3 }),
      area: L.canvas({ pane: 'coverage', padding: 0.3 }),
    };
    setMap(m);
    return () => setMap(null);
  }, []);

  useEffect(() => {
    if (!map) return;
    {
      const layers: L.Layer[] = [];
      if (mode === 'frequency') {
        const renderer = renderers.current!.lines;
        const ramp = FREQUENCY_RAMP[theme];
        const tip = L.tooltip({ sticky: true });
        const sorted = [...data.segments].sort((x, y) => x.perHour - y.perHour);
        const group = L.layerGroup().addTo(map);
        for (const s of sorted) {
          const bin = frequencyBin(s.perHour);
          L.polyline([s.a, s.b], {
            renderer,
            color: ramp[bin],
            weight: FREQUENCY_WEIGHTS[bin],
            opacity: 0.9,
            lineCap: 'round',
          })
            .on('mouseover', (e: L.LeafletMouseEvent) =>
              tip
                .setLatLng(e.latlng)
                .setContent(
                  escapeHtml(
                    t('outputs.tripsPerHourValue', {
                      value: formatNumber(locale, Math.round(s.perHour * 10) / 10),
                    })
                  )
                )
                .addTo(map)
            )
            .on('mouseout', () => tip.remove())
            .addTo(group);
        }
        layers.push(group, tip);
      } else {
        const renderer = renderers.current!.area;
        const group = L.layerGroup().addTo(map);
        const color = COVERAGE_COLOR[theme];
        for (const s of data.stops) {
          L.circle([s.lat, s.lon], {
            radius,
            renderer,
            pane: 'coverage',
            stroke: false,
            fillColor: color,
            fillOpacity: 1,
            interactive: false,
          }).addTo(group);
        }
        const dots = L.layerGroup().addTo(map);
        for (const s of data.stops) {
          L.circleMarker([s.lat, s.lon], {
            radius: 2.5,
            color,
            weight: 1,
            fillColor: color,
            fillOpacity: 1,
          })
            .bindTooltip(
              `<strong>${escapeHtml(s.name ?? s.stopId)}</strong><br>${escapeHtml(
                t('outputs.callsInWindow', { count: s.calls })
              )}`
            )
            .addTo(dots);
        }
        layers.push(group, dots);
      }
      return () => {
        for (const l of layers) l.remove();
      };
    }
  }, [map, data, mode, radius, theme, t, locale]);

  return (
    <BaseMap
      label={label}
      bounds={data.bbox}
      onReady={onReady}
      scrollZoom
      insetLeft={insetLeft}
      className="absolute inset-0"
    />
  );
}
