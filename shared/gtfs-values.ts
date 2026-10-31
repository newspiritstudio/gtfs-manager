/**
 * Conversió entre el text d'un fitxer GTFS i el valor que es desa: hores en segons, dates
 * AAAAMMDD, colors en hexadecimal sense `#`. La fan servir la importació, l'exportació i l'editor.
 */
import { isFloatField, isIntegerField, type GtfsField, type GtfsFieldType } from './gtfs-spec';

/** «25:07:30» → 90450. Accepta H:MM:SS (una xifra a l'hora, com permet l'especificació). */
export function parseGtfsTime(raw: string): number | null {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(raw.trim());
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** 90450 → «25:07:30». */
export function formatGtfsTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** 90450 → «01:07 (+1)», per a la interfície: l'hora del rellotge i el dia de servei de més. */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const total = Math.floor(seconds / 60);
  const days = Math.floor(total / 1440);
  const minutes = total % 1440;
  const label = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return days > 0 ? `${label} (+${days})` : label;
}

/** «2026-10-31» o «20261031» → «20261031»; null si no és una data real. */
export function parseGtfsDate(raw: string): string | null {
  const compact = raw.trim().replace(/-/g, '');
  if (!/^\d{8}$/.test(compact)) return null;
  const y = Number(compact.slice(0, 4));
  const m = Number(compact.slice(4, 6));
  const d = Number(compact.slice(6, 8));
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return compact;
}

/** «20261031» → Date UTC a mitjanit. */
export function gtfsDateToUtc(date: string): Date {
  return new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)))
  );
}

export function utcToGtfsDate(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate()
  ).padStart(2, '0')}`;
}

/** «20261031» → «2026-10-31» (per a <input type="date">). */
export function gtfsDateToIso(date: string | null | undefined): string {
  if (!date || date.length !== 8) return '';
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

export function addDays(date: string, days: number): string {
  const d = gtfsDateToUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return utcToGtfsDate(d);
}

/** «#75b6e0», «75B6E0» → «75B6E0». */
export function parseGtfsColor(raw: string): string | null {
  const hex = raw.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : null;
}

export type ParsedValue = { value: string | number | null; invalid: boolean };

/** El text d'una cel·la → el valor que es desa, segons el tipus del camp. Buit és null. */
export function parseFieldValue(type: GtfsFieldType, raw: string): ParsedValue {
  const text = raw.trim();
  if (text === '') return { value: null, invalid: false };
  switch (type) {
    case 'time': {
      const v = parseGtfsTime(text);
      return { value: v, invalid: v === null };
    }
    case 'date': {
      const v = parseGtfsDate(text);
      return { value: v, invalid: v === null };
    }
    case 'color': {
      const v = parseGtfsColor(text);
      return { value: v, invalid: v === null };
    }
    default:
      break;
  }
  if (isIntegerField(type)) {
    if (!/^[-+]?\d+$/.test(text)) return { value: null, invalid: true };
    const v = Number(text);
    return Number.isSafeInteger(v) && Math.abs(v) < 2 ** 31
      ? { value: v, invalid: false }
      : { value: null, invalid: true };
  }
  if (isFloatField(type)) {
    const v = Number(text);
    if (!Number.isFinite(v)) return { value: null, invalid: true };
    if (type === 'lat' && Math.abs(v) > 90) return { value: null, invalid: true };
    if (type === 'lon' && Math.abs(v) > 180) return { value: null, invalid: true };
    return { value: v, invalid: false };
  }
  return { value: text, invalid: false };
}

/** El valor desat → el text GTFS. */
export function formatFieldValue(field: GtfsField, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (field.type === 'time') return formatGtfsTime(Number(value));
  return String(value);
}

/**
 * La lluminositat relativa (WCAG) d'un color hexadecimal, per decidir el text que hi va a sobre
 * quan el feed no en porta (`route_text_color`).
 */
export function relativeLuminance(hex: string): number {
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** El text que es llegeix millor sobre un fons, si el feed no en diu cap. */
export function readableTextColor(background: string): string {
  return contrastRatio(background, 'FFFFFF') >= contrastRatio(background, '000000')
    ? 'FFFFFF'
    : '000000';
}

/** Un color estable per a una línia sense `route_color`, a partir del seu identificador. */
export function fallbackRouteColor(routeId: string): string {
  const palette = ['2A78D6', 'C4501F', '0E8A73', 'A26B00', 'C2407A', '008300', '4A3AA7', 'C93636'];
  let hash = 0;
  for (let i = 0; i < routeId.length; i++) hash = (hash * 31 + routeId.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

/**
 * Color de fons i de text d'una línia. El text del feed només es respecta si arriba a 4,5:1
 * (WCAG 1.4.3: els distintius són text petit); si no, es tria blanc o negre.
 */
export function routeColors(
  routeId: string,
  color: string | null | undefined,
  textColor: string | null | undefined
): { color: string; textColor: string } {
  const bg =
    color && /^[0-9A-F]{6}$/i.test(color) ? color.toUpperCase() : fallbackRouteColor(routeId);
  const fg =
    textColor && /^[0-9A-F]{6}$/i.test(textColor) && contrastRatio(bg, textColor) >= 4.5
      ? textColor.toUpperCase()
      : readableTextColor(bg);
  return { color: bg, textColor: fg };
}

/** La distància en metres entre dos punts (haversine). */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Un nom de línia tal com s'ha de llegir. Alguns feeds (Renfe) farceixen route_long_name amb
 * espais fins a una amplada fixa abans del guió que separa origen i destinació:
 * «Vic␣␣␣␣␣␣-Centelles» es llegeix «Vic – Centelles». Els guions sense farciment (noms com
 * «Granollers-Canovelles») no es toquen.
 */
export function tidyRouteName(name: string | null): string | null {
  if (name === null) return null;
  const tidy = name
    .replace(/\s{2,}-\s*/g, ' – ')
    .replace(/\s+/g, ' ')
    .trim();
  return tidy || null;
}
