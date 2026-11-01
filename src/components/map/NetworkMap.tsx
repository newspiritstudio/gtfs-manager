import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NetworkData, NetworkStop } from '@shared/contracts';
import type { RealtimeVehicle } from '@shared/realtime';
import { useResolvedTheme } from '@/lib/useResolvedTheme';
import BaseMap from './BaseMap';
import { badgeHtml, escapeHtml, mapPalette } from './colors';

export interface NetworkMapProps {
  data: NetworkData;
  label: string;
  /** The visible lines; null means all. */
  visibleRouteIds?: Set<string> | null;
  showStops?: boolean;
  /** Draws the flex zones (`data.zones`) under the lines. */
  showZones?: boolean;
  /** Highlighted lines (the others fade out). */
  highlightRouteIds?: string[] | null;
  selectedStopId?: string | null;
  onStopClick?: (stop: NetworkStop) => void;
  onRouteClick?: (routeId: string) => void;
  onMapClick?: (lat: number, lon: number) => void;
  interactive?: boolean;
  scrollZoom?: boolean;
  insetLeft?: number;
  /** Shows the stop name on hover. */
  stopTooltip?: (stop: NetworkStop) => string;
  /** Live vehicles (GTFS Realtime), drawn in their line's colour above everything else. */
  vehicles?: RealtimeVehicle[] | null;
  /** HTML for a vehicle's tooltip. */
  vehicleTooltip?: (vehicle: RealtimeVehicle) => string;
}

export default function NetworkMap({
  data,
  label,
  visibleRouteIds = null,
  showStops = true,
  showZones = true,
  highlightRouteIds = null,
  selectedStopId = null,
  onStopClick,
  onRouteClick,
  onMapClick,
  interactive = true,
  scrollZoom = false,
  insetLeft = 0,
  stopTooltip,
  vehicles = null,
  vehicleTooltip,
}: NetworkMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const zonesRef = useRef<L.LayerGroup | null>(null);
  const linesRef = useRef<L.LayerGroup | null>(null);
  const stopsRef = useRef<L.LayerGroup | null>(null);
  const vehiclesRef = useRef<L.LayerGroup | null>(null);
  // One renderer per layer and per map: a new one on every effect would leave a canvas at each zoom.
  const zoneRendererRef = useRef<L.Canvas | null>(null);
  const lineRendererRef = useRef<L.Canvas | null>(null);
  const stopRendererRef = useRef<L.Canvas | null>(null);
  const vehicleRendererRef = useRef<L.Canvas | null>(null);
  const theme = useResolvedTheme();
  const [zoom, setZoom] = useState(0);
  const handlers = useRef({ onStopClick, onRouteClick, onMapClick, stopTooltip, vehicleTooltip });
  handlers.current = { onStopClick, onRouteClick, onMapClick, stopTooltip, vehicleTooltip };
  const routeById = useMemo(() => new Map(data.routes.map((r) => [r.routeId, r])), [data.routes]);
  const highlight = useMemo(
    () => (highlightRouteIds?.length ? new Set(highlightRouteIds) : null),
    [highlightRouteIds]
  );
  const maxDepartures = useMemo(
    () => Math.max(1, ...data.stops.map((s) => s.departures)),
    [data.stops]
  );

  const onReady = (map: L.Map) => {
    mapRef.current = map;
    zonesRef.current = L.layerGroup().addTo(map);
    linesRef.current = L.layerGroup().addTo(map);
    stopsRef.current = L.layerGroup().addTo(map);
    vehiclesRef.current = L.layerGroup().addTo(map);
    // Added up front so stops always sit above the lines, and vehicles above both.
    zoneRendererRef.current = L.canvas({ padding: 0.5, tolerance: 2 }).addTo(map);
    lineRendererRef.current = L.canvas({ padding: 0.5, tolerance: 6 }).addTo(map);
    stopRendererRef.current = L.canvas({ padding: 0.5, tolerance: 4 }).addTo(map);
    vehicleRendererRef.current = L.canvas({ padding: 0.5, tolerance: 6 }).addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) =>
      handlers.current.onMapClick?.(e.latlng.lat, e.latlng.lng)
    );
    map.on('zoomend', () => setZoom(map.getZoom()));
    setZoom(map.getZoom());
    return () => {
      mapRef.current = null;
      zonesRef.current = null;
      zoneRendererRef.current = null;
      linesRef.current = null;
      stopsRef.current = null;
      vehiclesRef.current = null;
      lineRendererRef.current = null;
      stopRendererRef.current = null;
      vehicleRendererRef.current = null;
    };
  };

  // Flex zones: a translucent area with an outline, under everything else.
  useEffect(() => {
    const group = zonesRef.current;
    const renderer = zoneRendererRef.current;
    if (!group || !renderer) return;
    group.clearLayers();
    if (!showZones || !data.zones?.length) return;
    const palette = mapPalette();
    for (const zone of data.zones) {
      const layer = L.geoJSON(
        { type: 'Feature', properties: {}, geometry: zone.geometry } as GeoJSON.Feature,
        {
          style: {
            renderer,
            color: palette.primary,
            weight: 2,
            dashArray: '6 4',
            fillColor: palette.primary,
            fillOpacity: 0.12,
          },
        }
      ).addTo(group);
      if (interactive) {
        layer.bindTooltip(escapeHtml(zone.name ?? zone.locationId), {
          sticky: true,
          className: 'gtfs-map-tooltip',
        });
      }
    }
  }, [data.zones, showZones, theme, interactive]);

  // Lines: an outline in the surface colour underneath keeps them readable on any map.
  useEffect(() => {
    const group = linesRef.current;
    const renderer = lineRendererRef.current;
    if (!group || !renderer) return;
    group.clearLayers();
    const palette = mapPalette();
    const visible = data.lines.filter(
      (l) => !visibleRouteIds || l.routeIds.some((id) => visibleRouteIds.has(id))
    );
    const dimmed = Boolean(highlight);
    for (const line of visible) {
      const highlighted = highlight ? line.routeIds.some((id) => highlight.has(id)) : false;
      L.polyline(line.coords, {
        renderer,
        color: palette.surface,
        weight: highlighted ? 9 : 6,
        opacity: dimmed && !highlighted ? 0.3 : 0.9,
        interactive: false,
      }).addTo(group);
    }
    for (const line of visible) {
      const highlighted = highlight ? line.routeIds.some((id) => highlight.has(id)) : false;
      const routes = [...new Set(line.routeIds)].map((id) => routeById.get(id)).filter(Boolean);
      const seen = new Set<string>();
      const badges = routes
        .filter((r) => {
          const k = `${r!.shortName ?? r!.routeId}${r!.color}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .map((r) => badgeHtml(r!.shortName || r!.routeId, r!.color, r!.textColor))
        .join(' ');
      const poly = L.polyline(line.coords, {
        renderer,
        color: `#${line.color}`,
        weight: highlighted ? 6 : 3.5,
        opacity: dimmed && !highlighted ? 0.25 : 1,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(group);
      if (interactive) {
        poly.bindTooltip(`<div class="gtfs-map-tooltip-badges">${badges}</div>`, {
          sticky: true,
          direction: 'top',
          className: 'gtfs-map-tooltip',
        });
        poly.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          handlers.current.onRouteClick?.(line.routeIds[0]);
        });
      }
      if (highlighted) poly.bringToFront();
    }
  }, [data.lines, visibleRouteIds, highlight, routeById, theme, interactive]);

  // Stops: size reflects traffic volume.
  useEffect(() => {
    const group = stopsRef.current;
    const renderer = stopRendererRef.current;
    if (!group || !renderer) return;
    group.clearLayers();
    if (!showStops) return;
    const palette = mapPalette();
    // From afar, stops are small dots and the lines show; up close, they grow with traffic volume.
    const scale = Math.min(1.2, Math.max(0.3, (zoom - 7) / 5));
    const minorHidden = zoom < 9 && data.stops.length > 300;
    for (const stop of data.stops) {
      if (visibleRouteIds && !stop.routeIds.some((id) => visibleRouteIds.has(id))) continue;
      if (highlight && !stop.routeIds.some((id) => highlight.has(id))) continue;
      if (stop.locationType === 1 && stop.departures === 0 && data.stops.length > 2000) continue;
      const selected = stop.stopId === selectedStopId;
      const weight = Math.sqrt(stop.departures / maxDepartures);
      if (minorHidden && weight < 0.25 && stop.stopId !== selectedStopId) continue;
      const radius = (2.5 + 7 * weight) * scale;
      const marker = L.circleMarker([stop.lat, stop.lon], {
        renderer,
        radius: selected ? radius + 3 : radius,
        color: selected ? palette.primary : palette.onSurface,
        weight: selected ? 3 : scale < 0.6 ? 1 : 1.5,
        fillColor: palette.surface,
        fillOpacity: 1,
      }).addTo(group);
      if (interactive) {
        const tip = handlers.current.stopTooltip?.(stop) ?? escapeHtml(stop.name ?? stop.stopId);
        marker.bindTooltip(tip, {
          direction: 'top',
          offset: [0, -radius],
          className: 'gtfs-map-tooltip',
        });
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          handlers.current.onStopClick?.(stop);
        });
      }
    }
  }, [
    data.stops,
    showStops,
    visibleRouteIds,
    highlight,
    selectedStopId,
    maxDepartures,
    theme,
    interactive,
    zoom,
  ]);

  // Vehicles: a dot in the line colour with a surface ring, so it stands out over the line.
  useEffect(() => {
    const group = vehiclesRef.current;
    const renderer = vehicleRendererRef.current;
    if (!group || !renderer) return;
    group.clearLayers();
    if (!vehicles?.length) return;
    const palette = mapPalette();
    const radius = Math.min(8, Math.max(5, zoom - 5));
    for (const vehicle of vehicles) {
      if (vehicle.routeId && visibleRouteIds && !visibleRouteIds.has(vehicle.routeId)) continue;
      const route = vehicle.routeId ? routeById.get(vehicle.routeId) : undefined;
      const dimmed = highlight && !(vehicle.routeId && highlight.has(vehicle.routeId));
      const marker = L.circleMarker([vehicle.lat, vehicle.lon], {
        renderer,
        radius,
        color: palette.surface,
        weight: 2.5,
        fillColor: route ? `#${route.color}` : palette.onSurface,
        fillOpacity: dimmed ? 0.3 : 1,
        opacity: dimmed ? 0.3 : 1,
      }).addTo(group);
      if (interactive) {
        const tip = handlers.current.vehicleTooltip?.(vehicle);
        if (tip) {
          marker.bindTooltip(tip, {
            direction: 'top',
            offset: [0, -radius],
            className: 'gtfs-map-tooltip',
          });
        }
      }
    }
  }, [vehicles, visibleRouteIds, highlight, routeById, theme, interactive, zoom]);

  return (
    <BaseMap
      onReady={onReady}
      label={label}
      bounds={data.bbox}
      interactive={interactive}
      scrollZoom={scrollZoom}
      insetLeft={insetLeft}
    />
  );
}
