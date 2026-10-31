'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { useResolvedTheme } from '@/lib/useResolvedTheme';
import { cn } from '@/lib/utils';

// Grey Esri tiles (no key): the map stays in the background and the line colours dominate.
const TILES = {
  light:
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
};
const ATTRIBUTION =
  'Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/**
 * The base map: Leaflet with a canvas renderer (thousands of stops and lines without one DOM
 * node each) and the grey Esri tiles of the theme currently shown. On a touch screen, a map
 * inside a page (without `scrollZoom`) is not dragged with one finger, so it does not trap the
 * page scroll: it moves with two fingers. `onReady` receives the map to add layers to.
 */
export default function BaseMap({
  onReady,
  className,
  label,
  bounds,
  interactive = true,
  scrollZoom = false,
  insetLeft = 0,
}: {
  onReady: (map: L.Map) => void | (() => void);
  className?: string;
  label: string;
  bounds?: [number, number, number, number] | null;
  interactive?: boolean;
  /** The mouse wheel zooms. Only on maps that fill the screen: inside a page, the wheel must scroll the page. */
  scrollZoom?: boolean;
  /** Pixels on the left covered by a panel: network fitting and zoom avoid them. */
  insetLeft?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const theme = useResolvedTheme();
  const { t } = useI18n();
  const zoomTitles = useRef({ zoomIn: t('map.zoomIn'), zoomOut: t('map.zoomOut') });
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      preferCanvas: true,
      zoomControl: false,
      attributionControl: true,
      dragging: interactive && (scrollZoom || !L.Browser.mobile),
      scrollWheelZoom: interactive && scrollZoom,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
      touchZoom: interactive,
      zoomSnap: 0.25,
    });
    mapRef.current = map;
    const container = containerRef.current;
    const fit = () => {
      if (bounds && bounds[0] === bounds[2] && bounds[1] === bounds[3]) {
        // A single point: fitBounds would go to the maximum zoom, with enlarged, blurry tiles.
        map.setView([bounds[0], bounds[1]], 16, { animate: false });
      } else if (bounds) {
        map.fitBounds(
          [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          {
            paddingTopLeft: [24 + (container.clientWidth >= 768 ? insetLeft : 0), 24],
            paddingBottomRight: [24, 24],
            maxZoom: 16,
            animate: false,
          }
        );
      } else {
        map.setView([41.39, 2.17], 6);
      }
    };
    if (interactive)
      L.control
        .zoom({
          position: insetLeft ? 'topright' : 'topleft',
          zoomInTitle: zoomTitles.current.zoomIn,
          zoomOutTitle: zoomTitles.current.zoomOut,
        })
        .addTo(map);
    fit();
    const cleanup = readyRef.current(map);
    // If the container resizes before the person touches the map, the network is fitted again:
    // the first fit may have used the container's provisional height.
    let touched = false;
    const markTouched = () => {
      touched = true;
    };
    container.addEventListener('pointerdown', markTouched);
    container.addEventListener('wheel', markTouched, { passive: true });
    container.addEventListener('keydown', markTouched);
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      if (!touched) fit();
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      container.removeEventListener('pointerdown', markTouched);
      container.removeEventListener('wheel', markTouched);
      container.removeEventListener('keydown', markTouched);
      if (typeof cleanup === 'function') cleanup();
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
    };
    // The map is created once; the initial bounds only matter on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileRef.current?.remove();
    tileRef.current = L.tileLayer(TILES[theme], {
      attribution: ATTRIBUTION,
      maxNativeZoom: 16,
      maxZoom: 19,
    }).addTo(map);
    tileRef.current.bringToBack();
  }, [theme]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={label}
      className={cn('gtfs-map h-full w-full bg-surface-container-highest', className)}
    />
  );
}
