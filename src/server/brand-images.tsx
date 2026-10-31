/**
 * Imatges de marca generades (Open Graph i icona d'Apple): el logotip i l'esquema de xarxa de la
 * portada, amb colors fixos perquè no depenen del tema.
 */
const NAVY = '#1f4f86';

export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="${NAVY}"/><g fill="none" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 26 14 17.5 18.5 13h8" stroke="#f5a524"/><path d="M5.5 17.5H19l7 7" stroke="#5ec8f2"/><path d="M14 5.5v21" stroke="#fff"/></g><circle cx="14" cy="17.5" r="4" fill="#fff"/><circle cx="14" cy="17.5" r="1.9" fill="${NAVY}"/></svg>`;

/** El logotip a sang, sense cantonades: iOS ja n'arrodoneix la icona. */
export const APPLE_ICON_SVG = LOGO_SVG.replace('rx="9"', 'rx="0"');

const NETWORK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360"><g fill="none" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"><path d="M224 28v304" stroke="#ffffff"/><path d="M40 316 152 204l72-72h216" stroke="#f5a524"/><path d="M40 204h264l80 80h56" stroke="#5ec8f2"/><path d="M92 52l52 52h176l60-60" stroke="#3fb67a"/></g><g fill="${NAVY}" stroke="#ffffff" stroke-width="4">${[
  [40, 316],
  [96, 260],
  [300, 132],
  [380, 132],
  [440, 132],
  [40, 204],
  [96, 204],
  [344, 244],
  [440, 284],
  [92, 52],
  [380, 44],
  [272, 104],
]
  .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7"/>`)
  .join('')}</g><g fill="${NAVY}" stroke="#ffffff" stroke-width="5">${[
  [224, 132],
  [224, 204],
  [152, 204],
  [224, 104],
]
  .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="13"/>`)
  .join('')}</g></svg>`;

export const svgDataUri = (svg: string) =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

export function SocialCard() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        background: `linear-gradient(135deg, ${NAVY} 0%, #12335a 100%)`,
        padding: '64px 72px',
        color: '#ffffff',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <img src={svgDataUri(LOGO_SVG)} width={112} height={112} alt="" />
        <div style={{ fontSize: 84, fontWeight: 700, marginTop: 40, lineHeight: 1 }}>
          GTFS Manager
        </div>
        <div style={{ fontSize: 30, marginTop: 28, color: '#b8cdf0', lineHeight: 1.4 }}>
          agency · stops · routes · trips · stop_times · calendar · shapes
        </div>
      </div>
      <img src={svgDataUri(NETWORK_SVG)} width={480} height={360} alt="" />
    </div>
  );
}
