'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';

/**
 * El nom llegible de l'última molla. Les pàgines de detall (una parada, una línia, un viatge) el
 * coneixen i la barra superior només veu l'identificador de la URL: aquesta peça els uneix.
 */
type Parent = { label: string; href: string };
type Entry = { path: string; label: string; parent?: Parent } | null;
let current: Entry = null;
const listeners = new Set<() => void>();

function set(entry: Entry) {
  current = entry;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `parent` afegeix una molla entre la secció i el detall (un viatge penja de la seva línia). */
export default function CrumbLabel({ label, parent }: { label: string; parent?: Parent }) {
  const pathname = usePathname();
  const parentLabel = parent?.label;
  const parentHref = parent?.href;
  useEffect(() => {
    set({
      path: pathname,
      label,
      parent: parentLabel && parentHref ? { label: parentLabel, href: parentHref } : undefined,
    });
    return () => set(null);
  }, [pathname, label, parentLabel, parentHref]);
  return null;
}

export function useCrumbLabel(pathname: string): { label: string; parent?: Parent } | null {
  const entry = useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  );
  return entry?.path === pathname ? entry : null;
}
