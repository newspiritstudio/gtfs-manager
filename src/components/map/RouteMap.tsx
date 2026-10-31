'use client';

import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { useResolvedTheme } from '@/lib/useResolvedTheme';
import BaseMap from './BaseMap';
import { escapeHtml, mapPalette } from './colors';

export interface RouteMapStop {
  id: string;
  name: string | null;
  lat: number | null;
  lon: number | null;
  /** Text curt abans del nom a l'etiqueta (una hora, l'ordre...). */
  caption?: string;
}

/** Una línia o un viatge: el traçat del color de la línia i les parades en ordre. */
export default function RouteMap({
  lines,
  stops,
  color,
  label,
  onStopClick,
  activeStopId,
  connect = true,
}: {
  lines: [number, number][][];
  stops: RouteMapStop[];
  color: string;
  label: string;
  onStopClick?: (stopId: string) => void;
  activeStopId?: string | null;
  /** Uneix les parades amb una línia de punts quan no hi ha traçat. */
  connect?: boolean;
}) {
  const groupRef = useRef<L.LayerGroup | null>(null);
  const rendererRef = useRef<L.Canvas | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const theme = useResolvedTheme();
  const clickRef = useRef(onStopClick);
  clickRef.current = onStopClick;

  const points = [
    ...lines.flat(),
    ...stops
      .filter((s) => s.lat !== null && s.lon !== null)
      .map((s) => [s.lat!, s.lon!] as [number, number]),
  ];
  const bounds: [number, number, number, number] | null = points.length
    ? [
        Math.min(...points.map((p) => p[0])),
        Math.min(...points.map((p) => p[1])),
        Math.max(...points.map((p) => p[0])),
        Math.max(...points.map((p) => p[1])),
      ]
    : null;

  useEffect(() => {
    const group = groupRef.current;
    const renderer = rendererRef.current;
    if (!group || !renderer) return;
    group.clearLayers();
    const palette = mapPalette();
    const stroke = color ? `#${color}` : palette.primary;
    const traces = lines.length
      ? lines
      : !connect
        ? []
        : [
            stops
              .filter((s) => s.lat !== null && s.lon !== null)
              .map((s) => [s.lat!, s.lon!] as [number, number]),
          ];
    for (const coords of traces) {
      L.polyline(coords, { renderer, color: palette.surface, weight: 9, opacity: 0.9 }).addTo(
        group
      );
    }
    for (const coords of traces) {
      L.polyline(coords, {
        renderer,
        color: stroke,
        weight: 5,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: lines.length ? undefined : '1 8',
      }).addTo(group);
    }
    stops.forEach((s, i) => {
      if (s.lat === null || s.lon === null) return;
      const endpoint = i === 0 || i === stops.length - 1;
      const active = s.id === activeStopId;
      const marker = L.circleMarker([s.lat, s.lon], {
        renderer,
        radius: active ? 9 : endpoint ? 7 : 5,
        color: endpoint || active ? stroke : palette.onSurface,
        weight: endpoint || active ? 4 : 2,
        fillColor: palette.surface,
        fillOpacity: 1,
      }).addTo(group);
      marker.bindTooltip(
        `${s.caption ? `<strong>${escapeHtml(s.caption)}</strong> · ` : ''}${escapeHtml(s.name ?? s.id)}`,
        { direction: 'top', className: 'gtfs-map-tooltip', permanent: false }
      );
      marker.on('click', () => clickRef.current?.(s.id));
    });
  }, [lines, stops, color, theme, activeStopId, connect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activeStopId) return;
    const s = stops.find((x) => x.id === activeStopId);
    // Només es mou el mapa si la parada en queda fora: si no, passar el ratolí per l'esquema el desquadra.
    if (
      s &&
      s.lat !== null &&
      s.lon !== null &&
      !map.getBounds().pad(-0.1).contains([s.lat, s.lon])
    ) {
      map.panTo([s.lat, s.lon], { animate: true });
    }
  }, [activeStopId, stops]);

  return (
    <BaseMap
      label={label}
      bounds={bounds}
      onReady={(map) => {
        mapRef.current = map;
        groupRef.current = L.layerGroup().addTo(map);
        rendererRef.current = L.canvas({ padding: 0.5 }).addTo(map);
        return () => {
          mapRef.current = null;
          groupRef.current = null;
          rendererRef.current = null;
        };
      }}
    />
  );
}
