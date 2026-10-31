import { usePathname } from '@/lib/router';
import { useEffect, useSyncExternalStore } from 'react';

/**
 * The readable name of the last breadcrumb. Detail pages (a stop, a line, a trip) know it, while
 * the top bar only sees the identifier in the URL: this component connects them.
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

/** `parent` adds a crumb between the section and the detail (a trip hangs off its line). */
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
