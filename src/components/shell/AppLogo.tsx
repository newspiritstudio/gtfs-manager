/**
 * The logo: a piece of schematic map: three lines, at 0° and 45°, meeting at an interchange.
 * The colours are fixed (not tokens): it is the brand, the same in light and dark themes, and
 * the same as `app/icon.svg`.
 */
export default function AppLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="9" fill="#1f4f86" />
      <g fill="none" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5.5 26 14 17.5 18.5 13h8" stroke="#f5a524" />
        <path d="M5.5 17.5H19l7 7" stroke="#5ec8f2" />
        <path d="M14 5.5v21" stroke="#fff" />
      </g>
      <circle cx="14" cy="17.5" r="4" fill="#fff" />
      <circle cx="14" cy="17.5" r="1.9" fill="#1f4f86" />
    </svg>
  );
}
