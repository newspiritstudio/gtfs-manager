import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

const GAP = 4;
const MAX_HEIGHT = 320;

/** Where a menu goes: under its anchor, or over it when there is more room above. */
function placement(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom - GAP * 2;
  const above = rect.top - GAP * 2;
  const up = below < Math.min(MAX_HEIGHT, 200) && above > below;
  return {
    left: rect.left,
    width: rect.width,
    maxHeight: Math.min(MAX_HEIGHT, up ? above : below),
    ...(up ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
  };
}

/**
 * The fixed position of a menu that floats over the page (in a portal, so a dialog or a scrolling
 * card does not clip it). It follows the anchor while anything scrolls and when the window resizes.
 */
export function useFloatingPlacement(open: boolean, anchor: RefObject<HTMLElement | null>) {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => anchor.current && setStyle(placement(anchor.current));
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, anchor]);
  return style;
}

/** The classes of a floating menu: the same surface for every list. */
export const FLOATING_LIST =
  'fixed z-popover overflow-auto rounded-lg border border-outline-variant bg-floating py-1 outline-none';
