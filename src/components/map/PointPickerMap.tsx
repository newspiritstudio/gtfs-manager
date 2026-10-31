import L from 'leaflet';
import { useEffect, useRef } from 'react';
import BaseMap from './BaseMap';
import { mapPalette } from './colors';

/**
 * Picks a point by clicking the map. Existing stops (`context`, read on mount) are shown in the
 * background. If the point changes from outside (the coordinate fields), the map follows it.
 */
export default function PointPickerMap({
  value,
  onChange,
  context,
  label,
  bounds,
}: {
  value: { lat: number; lon: number } | null;
  onChange: (lat: number, lon: number) => void;
  context?: { lat: number; lon: number }[];
  label: string;
  bounds?: [number, number, number, number] | null;
}) {
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const palette = mapPalette();
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      markerRef.current = L.circleMarker([value.lat, value.lon], {
        radius: 10,
        color: palette.primary,
        weight: 4,
        fillColor: palette.surface,
        fillOpacity: 1,
      }).addTo(map);
    } else {
      markerRef.current.setLatLng([value.lat, value.lon]);
    }
    if (!map.getBounds().pad(-0.1).contains([value.lat, value.lon])) {
      map.panTo([value.lat, value.lon], { animate: false });
    }
  }, [value]);

  const initialBounds: [number, number, number, number] | null = value
    ? [value.lat - 0.01, value.lon - 0.01, value.lat + 0.01, value.lon + 0.01]
    : (bounds ?? null);

  return (
    <BaseMap
      label={label}
      bounds={initialBounds}
      onReady={(map) => {
        mapRef.current = map;
        map.getContainer().style.cursor = 'crosshair';
        const palette = mapPalette();
        const renderer = L.canvas();
        for (const p of context ?? []) {
          L.circleMarker([p.lat, p.lon], {
            renderer,
            radius: 3,
            color: palette.outline,
            weight: 1,
            fillOpacity: 0.6,
            interactive: false,
          }).addTo(map);
        }
        map.on('click', (e: L.LeafletMouseEvent) =>
          changeRef.current(Number(e.latlng.lat.toFixed(7)), Number(e.latlng.lng.toFixed(7)))
        );
        return () => {
          mapRef.current = null;
          markerRef.current = null;
        };
      }}
    />
  );
}
