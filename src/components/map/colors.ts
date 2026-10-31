/** Reads a colour token from the current theme (maps paint on canvas and do not understand var()). */
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function mapPalette() {
  return {
    surface: cssVar('--md-sys-color-surface', '#ffffff'),
    onSurface: cssVar('--md-sys-color-on-surface', '#191c21'),
    outline: cssVar('--md-sys-color-outline', '#717784'),
    primary: cssVar('--md-sys-color-primary', '#225488'),
  };
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}

/** A GTFS colour (six hex digits) or, if the feed ships it malformed, the fallback. */
function hex(value: string, fallback: string): string {
  return /^[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function badgeHtml(name: string, color: string, textColor: string): string {
  color = hex(color, 'ffffff');
  textColor = hex(textColor, '000000');
  return `<span class="gtfs-map-badge" style="background:#${color};color:#${textColor}">${escapeHtml(name)}</span>`;
}
