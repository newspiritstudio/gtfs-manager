/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'primary': 'var(--md-sys-color-primary)',
        'on-primary': 'var(--md-sys-color-on-primary)',
        'primary-container': 'var(--md-sys-color-primary-container)',
        'on-primary-container': 'var(--md-sys-color-on-primary-container)',
        // Tints de primary per a un fons triat o destacat, en lloc de `bg-primary/NN` (n'hi havia
        // dotze opacitats). `primary-tint`: seleccionat, casella d'icona, xip actiu (12 %).
        // `primary-tint-subtle`: una caixa o fila destacada (6 %, per sota del hover del 8 %).
        // Es resolen a l'element (color-mix aquí, no una variable a :root), de manera que segueixen
        // el primary que redefineix una pàgina amb la marca del client. El hover no és un tint:
        // és `state-layer` (src/index.css).
        'primary-tint':
          'color-mix(in oklab, var(--md-sys-color-primary) calc(var(--md-sys-state-selected) * 100%), transparent)',
        'primary-tint-subtle':
          'color-mix(in oklab, var(--md-sys-color-primary) calc(var(--md-sys-state-highlight) * 100%), transparent)',
        'secondary':'var(--md-sys-color-secondary)',
        'on-secondary': 'var(--md-sys-color-on-secondary)',
        'secondary-container': 'var(--md-sys-color-secondary-container)',
        'on-secondary-container': 'var(--md-sys-color-on-secondary-container)',
        'tertiary': 'var(--md-sys-color-tertiary)',
        'on-tertiary': 'var(--md-sys-color-on-tertiary)',
        'tertiary-container': 'var(--md-sys-color-tertiary-container)',
        'on-tertiary-container': 'var(--md-sys-color-on-tertiary-container)',
        'error': 'var(--md-sys-color-error)',
        'on-error': 'var(--md-sys-color-on-error)',
        'error-container': 'var(--md-sys-color-error-container)',
        'on-error-container': 'var(--md-sys-color-on-error-container)',
        'surface': 'var(--md-sys-color-surface)',
        'on-surface': 'var(--md-sys-color-on-surface)',
        'surface-variant': 'var(--md-sys-color-surface-variant)',
        'on-surface-variant': 'var(--md-sys-color-on-surface-variant)',
        // Text terciari validat (≥4,5:1 sobre totes les superfícies). No es fa
        // servir mai `text-on-surface-variant/NN`: l'opacitat no garanteix el contrast.
        'on-surface-muted': 'var(--md-sys-color-on-surface-muted)',
        'outline': 'var(--md-sys-color-outline)',
        'outline-variant': 'var(--md-sys-color-outline-variant)',
        // Separador suau i sòlid, en lloc de `border-outline-variant/NN`.
        'outline-subtle': 'var(--md-sys-color-outline-subtle)',
        'scrim': 'var(--md-sys-color-scrim)',
        'inverse-surface': 'var(--md-sys-color-inverse-surface)',
        'inverse-on-surface': 'var(--md-sys-color-inverse-on-surface)',
        'inverse-primary': 'var(--md-sys-color-inverse-primary)',
        'surface-dim': 'var(--md-sys-color-surface-dim)',
        'surface-bright': 'var(--md-sys-color-surface-bright)',
        'surface-container-lowest': 'var(--md-sys-color-surface-container-lowest)',
        // Fons únic dels camps d'escriptura (vegeu --md-sys-color-field a index.css).
        'field': 'var(--md-sys-color-field)',
        'surface-container-low': 'var(--md-sys-color-surface-container-low)',
        'surface-container': 'var(--md-sys-color-surface-container)',
        'surface-container-high': 'var(--md-sys-color-surface-container-high)',
        'surface-container-highest': 'var(--md-sys-color-surface-container-highest)',
        // Contenidor tonal (docs/ui-containers-and-shape.md): el to el decideix on és. Sobre la
        // pàgina, surface-container; dins d'un altre contenidor, -highest; dins d'un diàleg,
        // -lowest; dins d'un menú, surface-container (src/index.css). Un contenidor es
        // distingeix pel fons, no per una vora.
        'tonal': 'var(--surface-tonal, var(--md-sys-color-surface-container))',
        // El to del contenidor tonal que l'envolta, per a una peça que l'ha de tapar sense
        // destacar-ne (capçalera enganxada, cel·la fixa en desplaçar de costat).
        'tonal-self': 'var(--tonal-self, var(--md-sys-color-surface))',
        // Superfície flotant (menús, popovers, fulls mòbils): el fons de la pàgina, amb la vora
        // que la separa del que té a sota. Un sol lloc per decidir el to de tots els menús.
        'floating': 'var(--md-sys-color-surface)',
        // M3 Fixed color roles — theme-independent accent surfaces
        'primary-fixed': 'var(--md-sys-color-primary-fixed)',
        'primary-fixed-dim': 'var(--md-sys-color-primary-fixed-dim)',
        'on-primary-fixed': 'var(--md-sys-color-on-primary-fixed)',
        'on-primary-fixed-variant': 'var(--md-sys-color-on-primary-fixed-variant)',
        'secondary-fixed': 'var(--md-sys-color-secondary-fixed)',
        'secondary-fixed-dim': 'var(--md-sys-color-secondary-fixed-dim)',
        'on-secondary-fixed': 'var(--md-sys-color-on-secondary-fixed)',
        'on-secondary-fixed-variant': 'var(--md-sys-color-on-secondary-fixed-variant)',
        'tertiary-fixed': 'var(--md-sys-color-tertiary-fixed)',
        'tertiary-fixed-dim': 'var(--md-sys-color-tertiary-fixed-dim)',
        'on-tertiary-fixed': 'var(--md-sys-color-on-tertiary-fixed)',
        'on-tertiary-fixed-variant': 'var(--md-sys-color-on-tertiary-fixed-variant)',
        // Semantic status colors — two tokens per state and no more:
        // `X-container` is the soft background, `X` is the content that goes on it.
        // There is deliberately no `on-X`: it used to be an exact duplicate of `X`,
        // so `bg-success text-on-success` painted text the colour of its own
        // background. `X` on its own is still correct for dots, bars and fills,
        // which carry no text.
        'success': 'var(--support-positive-on)',
        'success-container': 'var(--support-positive-container)',
        'warning': 'var(--support-caution-on)',
        'warning-container': 'var(--support-caution-container)',
        'info': 'var(--support-info-on)',
        'info-container': 'var(--support-info-container)',
        'critical': 'var(--support-critical-on)',
        'critical-container': 'var(--support-critical-container)',
      },
      // M3 Shape Scale - use rounded-{size} for semantic radii
      borderRadius: {
        'none': 'var(--md-sys-shape-corner-none)',
        'xs': 'var(--md-sys-shape-corner-extra-small)',
        'sm': 'var(--md-sys-shape-corner-small)',
        'md': 'var(--md-sys-shape-corner-medium)',
        'lg': 'var(--md-sys-shape-corner-large)',
        'lg-inc': 'var(--md-sys-shape-corner-large-increased)',
        'xl': 'var(--md-sys-shape-corner-extra-large)',
        '2xl': 'var(--md-sys-shape-corner-extra-extra-large)',
        'full': 'var(--md-sys-shape-corner-full)',
      },
      // Font family - matches Google Sans in index.css
      fontFamily: {
        'sans': ['Google Sans', 'system-ui', 'sans-serif'],
      },
      // Aliases for dense UI text-sizes that sit below M3 label-small (11px).
      // Use these instead of arbitrary text-[10px]/text-[11px] when no extra
      // weight/tracking override is needed. The full M3 type scale lives in
      // .text-display-*/.text-headline-*/.text-title-*/.text-body-*/.text-label-*
      // utility classes defined in src/index.css.
      fontSize: {
        // Only the size, like the text-[9px] it replaces: the line height is inherited.
        'nano': '9px',                                // locale tags, counter dots on 16 px icons
        'micro': ['10px', { lineHeight: '14px' }],   // chips, meta labels, watermarks
        'tiny': ['11px', { lineHeight: '16px' }],    // same size as label-small but no extra weight
      },
      // Semantic z-index scale — replaces arbitrary z-[NNN] values.
      // Values come from the --z-* variables in src/index.css (single source). When picking a value:
      //   above       → a sibling painted over its neighbours inside one component
      //                 (sticky day pill, all-day band, overlapping meeting block)
      //   raised      → dragged/sticky items lifted above base content
      //   sticky-inner → sticky bars/columns inside a scrolling panel, below the
      //                 page-level sticky headers (dragged timeline bar too)
      //   sticky      → sticky headers / toolbars that overlap scrolling content
      //   fab         → floating action button (Tailwind default z-50 preserved)
      //   banner      → persistent banners (cookie consent, demo mode)
      //   modal       → modal dialogs and full-page overlays
      //   modal-loading → loading state shown on top of a modal
      //   popover     → dropdowns / popovers / context menus (must beat modals)
      //   system-dialog → cmdK, keyboard shortcuts, context switcher (top-level)
      //   toast       → toast notifications
      //   mobile-overlay     → mobile drawer backdrop (must beat everything UI)
      //   mobile-overlay-top → mobile drawer surface, confetti (topmost)
      zIndex: {
        'base': 'var(--z-base)',
        'above': 'var(--z-above)',
        'raised': 'var(--z-raised)',
        'sticky-inner': 'var(--z-sticky-inner)',
        'sticky': 'var(--z-sticky)',
        'fab': 'var(--z-fab)',
        'banner': 'var(--z-banner)',
        'modal': 'var(--z-modal)',
        'modal-loading': 'var(--z-modal-loading)',
        'popover': 'var(--z-popover)',
        'system-dialog': 'var(--z-system-dialog)',
        'toast': 'var(--z-toast)',
        'mobile-overlay': 'var(--z-mobile-overlay)',
        'mobile-overlay-top': 'var(--z-mobile-overlay-top)',
      },
    },
  },
  plugins: [],
}
