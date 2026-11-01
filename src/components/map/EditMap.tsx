import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { haversineMeters } from '@shared/gtfs-values';
import { formatDistance } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import { useResolvedTheme } from '@/lib/useResolvedTheme';
import BaseMap from './BaseMap';
import { escapeHtml, mapPalette } from './colors';

export type LatLon = [number, number];

export interface EditMapStop {
  id: string;
  name: string | null;
  lat: number | null;
  lon: number | null;
}

export type EditMode = 'stops' | 'add' | 'shape';

/** Most vertex handles drawn at once (the ones inside the view): a dense shape has thousands. */
const MAX_HANDLES = 400;

/** Where to insert a click into a polyline: the nearest stretch, or one of the ends. */
export function insertVertex(points: LatLon[], at: LatLon): LatLon[] {
  if (points.length < 2) return [...points, at];
  const kx = Math.cos((at[0] * Math.PI) / 180);
  let best = Infinity;
  let index = 0;
  let along = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const ax = (points[i][1] - at[1]) * kx;
    const ay = points[i][0] - at[0];
    const bx = (points[i + 1][1] - at[1]) * kx;
    const by = points[i + 1][0] - at[0];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const d = (ax + t * dx) ** 2 + (ay + t * dy) ** 2;
    if (d < best) {
      best = d;
      index = i;
      along = t;
    }
  }
  const out = [...points];
  if (index === 0 && along === 0) out.unshift(at);
  else if (index === points.length - 2 && along === 1) out.push(at);
  else out.splice(index + 1, 0, at);
  return out;
}

function stopIcon(n: number, stroke: string, palette: ReturnType<typeof mapPalette>, on: boolean) {
  const size = on ? 28 : 24;
  return L.divIcon({
    className: 'gtfs-edit-stop',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;box-sizing:border-box;border:3px solid ${stroke};background:${on ? stroke : palette.surface};color:${on ? palette.surface : palette.onSurface};font:600 ${n > 99 ? 8 : 10}px/${size - 6}px system-ui,sans-serif;text-align:center;cursor:grab">${n}</div>`,
  });
}

function vertexIcon(palette: ReturnType<typeof mapPalette>, stroke: string) {
  return L.divIcon({
    className: 'gtfs-edit-vertex',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<div style="width:14px;height:14px;box-sizing:border-box;border:2px solid ${stroke};background:${palette.surface};border-radius:3px;cursor:grab"></div>`,
  });
}

/**
 * The map of the route editor. Stops are draggable markers numbered by their order (the
 * distance moved shows while dragging); other stops nearby are small dots that add themselves to
 * the pattern when clicked; in shape mode the line has vertex handles (drag to move, click the
 * line to add one, right-click or double-click a handle to delete it).
 */
export default function EditMap({
  stops,
  context,
  shape,
  mode,
  selectedIndex,
  color,
  label,
  fitKey,
  onSelect,
  onMoveStop,
  onPickContext,
  onMapClick,
  onShapeChange,
  onViewport,
}: {
  stops: EditMapStop[];
  context: EditMapStop[];
  shape: LatLon[] | null;
  mode: EditMode;
  selectedIndex: number | null;
  color: string;
  label: string;
  /** Changes when the map should fit what it shows again (another pattern). */
  fitKey: string;
  onSelect: (index: number) => void;
  onMoveStop: (stopId: string, lat: number, lon: number) => void;
  onPickContext: (stopId: string) => void;
  onMapClick: (lat: number, lon: number) => void;
  onShapeChange: (points: LatLon[]) => void;
  onViewport: (bbox: [number, number, number, number]) => void;
}) {
  const { locale } = useI18n();
  const theme = useResolvedTheme();
  const mapRef = useRef<L.Map | null>(null);
  const groupRef = useRef<L.LayerGroup | null>(null);
  const handlesRef = useRef<L.LayerGroup | null>(null);
  const rendererRef = useRef<L.Canvas | null>(null);
  const fittedRef = useRef('');
  const cb = useRef({
    onSelect,
    onMoveStop,
    onPickContext,
    onMapClick,
    onShapeChange,
    onViewport,
    mode,
    shape,
  });
  cb.current = {
    onSelect,
    onMoveStop,
    onPickContext,
    onMapClick,
    onShapeChange,
    onViewport,
    mode,
    shape,
  };

  const valid = stops.filter((s) => s.lat !== null && s.lon !== null);
  const initialBounds: [number, number, number, number] | null = valid.length
    ? [
        Math.min(...valid.map((s) => s.lat!)),
        Math.min(...valid.map((s) => s.lon!)),
        Math.max(...valid.map((s) => s.lat!)),
        Math.max(...valid.map((s) => s.lon!)),
      ]
    : null;

  // Stops, context dots and the line.
  useEffect(() => {
    const group = groupRef.current;
    const renderer = rendererRef.current;
    const map = mapRef.current;
    if (!group || !renderer || !map) return;
    group.clearLayers();
    const palette = mapPalette();
    const stroke = color ? `#${color}` : palette.primary;
    const path = shape?.length ? shape : valid.map((s) => [s.lat!, s.lon!] as LatLon);
    if (path.length > 1) {
      L.polyline(path, {
        renderer,
        color: palette.surface,
        weight: 9,
        opacity: 0.9,
        interactive: false,
      }).addTo(group);
      const line = L.polyline(path, {
        renderer,
        color: stroke,
        weight: 5,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: shape?.length ? undefined : '1 8',
        interactive: mode === 'shape',
        bubblingMouseEvents: false,
      }).addTo(group);
      if (mode === 'shape' && shape?.length)
        line.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stop(e);
          cb.current.onShapeChange(
            insertVertex(cb.current.shape ?? [], [e.latlng.lat, e.latlng.lng])
          );
        });
    }
    for (const s of context) {
      if (s.lat === null || s.lon === null) continue;
      const dot = L.circleMarker([s.lat, s.lon], {
        renderer,
        radius: 4,
        color: palette.outline,
        weight: 1.5,
        fillColor: palette.surface,
        fillOpacity: 1,
        interactive: mode !== 'shape',
        bubblingMouseEvents: false,
      }).addTo(group);
      dot.bindTooltip(escapeHtml(s.name ?? s.id), {
        direction: 'top',
        className: 'gtfs-map-tooltip',
      });
      dot.on('click', (e) => {
        L.DomEvent.stop(e);
        cb.current.onPickContext(s.id);
      });
    }
    stops.forEach((s, i) => {
      if (s.lat === null || s.lon === null) return;
      const marker = L.marker([s.lat, s.lon], {
        icon: stopIcon(i + 1, stroke, palette, i === selectedIndex),
        draggable: mode === 'stops',
        keyboard: false,
        zIndexOffset: i === selectedIndex ? 1000 : 0,
        title: s.name ?? s.id,
      }).addTo(group);
      const origin: LatLon = [s.lat, s.lon];
      marker.bindTooltip(escapeHtml(s.name ?? s.id), {
        direction: 'top',
        offset: [0, -12],
        className: 'gtfs-map-tooltip',
      });
      marker.on('click', () => cb.current.onSelect(i));
      marker.on('dragstart', () => {
        marker.unbindTooltip();
        marker
          .bindTooltip('0 m', {
            permanent: true,
            direction: 'top',
            offset: [0, -14],
            className: 'gtfs-map-tooltip',
          })
          .openTooltip();
      });
      marker.on('drag', () => {
        const p = marker.getLatLng();
        marker.setTooltipContent(
          formatDistance(locale, haversineMeters(origin[0], origin[1], p.lat, p.lng))
        );
      });
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        cb.current.onMoveStop(s.id, Number(p.lat.toFixed(7)), Number(p.lng.toFixed(7)));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, context, shape, mode, selectedIndex, color, theme, locale]);

  // Vertex handles of the shape (only the ones in view).
  useEffect(() => {
    const map = mapRef.current;
    const layer = handlesRef.current;
    if (!map || !layer) return;
    const draw = () => {
      layer.clearLayers();
      if (mode !== 'shape' || !shape?.length) return;
      const palette = mapPalette();
      const stroke = color ? `#${color}` : palette.primary;
      const view = map.getBounds().pad(0.05);
      const visible: number[] = [];
      for (let i = 0; i < shape.length; i += 1) if (view.contains(shape[i])) visible.push(i);
      // Too many in view: take every nth, the rest appear as the person zooms in.
      const step = Math.max(1, Math.ceil(visible.length / MAX_HANDLES));
      for (let k = 0; k < visible.length; k += step) {
        const i = visible[k];
        const marker = L.marker(shape[i], {
          icon: vertexIcon(palette, stroke),
          draggable: true,
          keyboard: false,
        }).addTo(layer);
        marker.on('dragend', () => {
          const p = marker.getLatLng();
          const next = [...(cb.current.shape ?? [])];
          next[i] = [Number(p.lat.toFixed(7)), Number(p.lng.toFixed(7))];
          cb.current.onShapeChange(next);
        });
        const remove = () => {
          const current = cb.current.shape ?? [];
          if (current.length > 2) cb.current.onShapeChange(current.filter((_, j) => j !== i));
        };
        marker.on('contextmenu', remove);
        marker.on('dblclick', (e) => {
          L.DomEvent.stop(e);
          remove();
        });
      }
    };
    draw();
    map.on('moveend', draw);
    return () => {
      map.off('moveend', draw);
    };
  }, [shape, mode, color, theme]);

  // Fit again when another pattern is shown (once its stops are there).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !stops.length || fittedRef.current === fitKey) return;
    const points = [
      ...(shape ?? []),
      ...stops
        .filter((s) => s.lat !== null && s.lon !== null)
        .map((s) => [s.lat!, s.lon!] as LatLon),
    ];
    if (!points.length) return;
    fittedRef.current = fitKey;
    map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 16, animate: false });
  }, [fitKey, stops, shape]);

  // The cursor says what a click does.
  useEffect(() => {
    const el = mapRef.current?.getContainer();
    if (el) el.style.cursor = mode === 'stops' ? '' : 'crosshair';
  }, [mode]);

  return (
    <BaseMap
      label={label}
      bounds={initialBounds}
      scrollZoom
      onReady={(map) => {
        mapRef.current = map;
        rendererRef.current = L.canvas({ padding: 0.5 }).addTo(map);
        groupRef.current = L.layerGroup().addTo(map);
        handlesRef.current = L.layerGroup().addTo(map);
        map.doubleClickZoom.disable();
        map.on('click', (e: L.LeafletMouseEvent) => {
          const { mode: current } = cb.current;
          if (current === 'add')
            cb.current.onMapClick(Number(e.latlng.lat.toFixed(7)), Number(e.latlng.lng.toFixed(7)));
          else if (current === 'shape')
            cb.current.onShapeChange(
              insertVertex(cb.current.shape ?? [], [e.latlng.lat, e.latlng.lng])
            );
        });
        const report = () => {
          const b = map.getBounds();
          cb.current.onViewport([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
        };
        map.on('moveend', report);
        report();
        return () => {
          mapRef.current = null;
          groupRef.current = null;
          handlesRef.current = null;
          rendererRef.current = null;
        };
      }}
    />
  );
}
