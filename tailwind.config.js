/** @type {import('tailwindcss').Config} */
// Exposes the design tokens defined in src/index.css as Tailwind utilities. Colour roles are
// listed only when a class uses them; add the role here (and its variable in index.css) when
// you need a new one.
export default {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: 'var(--md-sys-color-primary)',
        'on-primary': 'var(--md-sys-color-on-primary)',
        // Primary tints for a selected or highlighted background, instead of `bg-primary/NN`.
        // `primary-tint`: selected, icon box, active chip (12 %).
        // `primary-tint-subtle`: a highlighted box or row (6 %, below the 8 % hover).
        // They resolve on the element with color-mix, so they follow the primary in the
        // active theme. Hover is not a tint: it is `state-layer` (src/index.css).
        'primary-tint':
          'color-mix(in oklab, var(--md-sys-color-primary) calc(var(--md-sys-state-selected) * 100%), transparent)',
        'primary-tint-subtle':
          'color-mix(in oklab, var(--md-sys-color-primary) calc(var(--md-sys-state-highlight) * 100%), transparent)',
        'secondary-container': 'var(--md-sys-color-secondary-container)',
        'on-secondary-container': 'var(--md-sys-color-on-secondary-container)',
        'tertiary-container': 'var(--md-sys-color-tertiary-container)',
        'on-tertiary-container': 'var(--md-sys-color-on-tertiary-container)',
        error: 'var(--md-sys-color-error)',
        'on-error': 'var(--md-sys-color-on-error)',
        surface: 'var(--md-sys-color-surface)',
        'on-surface': 'var(--md-sys-color-on-surface)',
        'on-surface-variant': 'var(--md-sys-color-on-surface-variant)',
        // Validated tertiary text (at least 4.5:1 on every surface). `text-on-surface-variant/NN`
        // is never used: opacity does not guarantee contrast.
        'on-surface-muted': 'var(--md-sys-color-on-surface-muted)',
        outline: 'var(--md-sys-color-outline)',
        'outline-variant': 'var(--md-sys-color-outline-variant)',
        // Soft, solid divider, instead of `border-outline-variant/NN`.
        'outline-subtle': 'var(--md-sys-color-outline-subtle)',
        scrim: 'var(--md-sys-color-scrim)',
        'inverse-surface': 'var(--md-sys-color-inverse-surface)',
        'inverse-on-surface': 'var(--md-sys-color-inverse-on-surface)',
        'surface-container-lowest': 'var(--md-sys-color-surface-container-lowest)',
        'surface-container-low': 'var(--md-sys-color-surface-container-low)',
        'surface-container': 'var(--md-sys-color-surface-container)',
        'surface-container-high': 'var(--md-sys-color-surface-container-high)',
        'surface-container-highest': 'var(--md-sys-color-surface-container-highest)',
        // Tonal container: where it sits decides its tone. On the page, surface-container;
        // inside another container, -highest; inside a dialog, -lowest (see `.bg-tonal` in
        // src/index.css). A container is told apart by its background, not by a border.
        tonal: 'var(--surface-tonal, var(--md-sys-color-surface-container))',
        // Floating surface (menus): the page background, with the border that separates it
        // from what is underneath. One place to decide the tone of all menus.
        floating: 'var(--md-sys-color-surface)',
        // Semantic status colours, two tokens per state: `X-container` is the soft background,
        // `X` is the content that goes on it. There is deliberately no `on-X`: it would be an
        // exact duplicate of `X`. `X` on its own is also right for dots, bars and fills.
        success: 'var(--support-positive-on)',
        'success-container': 'var(--support-positive-container)',
        warning: 'var(--support-caution-on)',
        'warning-container': 'var(--support-caution-container)',
        info: 'var(--support-info-on)',
        'info-container': 'var(--support-info-container)',
        critical: 'var(--support-critical-on)',
        'critical-container': 'var(--support-critical-container)',
      },
      // M3 shape scale: use rounded-{size} for semantic radii
      borderRadius: {
        none: 'var(--md-sys-shape-corner-none)',
        xs: 'var(--md-sys-shape-corner-extra-small)',
        sm: 'var(--md-sys-shape-corner-small)',
        md: 'var(--md-sys-shape-corner-medium)',
        lg: 'var(--md-sys-shape-corner-large)',
        'lg-inc': 'var(--md-sys-shape-corner-large-increased)',
        xl: 'var(--md-sys-shape-corner-extra-large)',
        '2xl': 'var(--md-sys-shape-corner-extra-extra-large)',
        full: 'var(--md-sys-shape-corner-full)',
      },
      // Matches the self-hosted Google Sans in src/index.css
      fontFamily: {
        sans: ['Google Sans', 'system-ui', 'sans-serif'],
      },
      // Semantic z-index scale, replacing arbitrary z-[NNN] values. The values live in the
      // --z-* variables in src/index.css (single source).
      //   modal         → dialogs and full-page overlays
      //   popover       → menus and dropdowns (must beat modals)
      //   toast         → notifications
      //   mobile-overlay → mobile drawer backdrop (must beat everything else)
      zIndex: {
        modal: 'var(--z-modal)',
        popover: 'var(--z-popover)',
        toast: 'var(--z-toast)',
        'mobile-overlay': 'var(--z-mobile-overlay)',
      },
    },
  },
  plugins: [],
};
