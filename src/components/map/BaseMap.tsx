'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { useResolvedTheme } from '@/lib/useResolvedTheme';
import { cn } from '@/lib/utils';

// Rajoles grises d'Esri (sense clau): el mapa queda en segon pla i els colors de les línies hi manen.
const TILES = {
  light:
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
};
const ATTRIBUTION =
  'Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/**
 * El mapa base: Leaflet amb renderitzador canvas (milers de parades i línies sense un node DOM
 * cadascuna) i les rajoles grises d'Esri del tema que es veu. A pantalla tàctil, un mapa dins
 * d'una pàgina (sense `scrollZoom`) no s'arrossega amb un dit, perquè no atrapi el desplaçament de
 * la pàgina: es mou amb dos dits. `onReady` rep el mapa per afegir-hi capes.
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
  /** La roda del ratolí fa zoom. Només als mapes que ocupen la pantalla: dins d'una pàgina, la roda ha de desplaçar la pàgina. */
  scrollZoom?: boolean;
  /** Píxels de l'esquerra tapats per un plafó: l'encaix de la xarxa i el zoom els eviten. */
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
        // Un sol punt: fitBounds aniria al zoom màxim, amb les rajoles ampliades i borroses.
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
    // Si el contenidor canvia de mida abans que la persona toqui el mapa, es torna a encaixar la
    // xarxa: el primer encaix es pot haver fet amb l'alçada provisional del contenidor.
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
    // El mapa es crea un cop; els límits inicials només compten en muntar-lo.
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
