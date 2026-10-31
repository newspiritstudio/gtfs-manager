/**
 * Navigation helpers over React Router, with the small surface the app uses: `Link`,
 * `useRouter`, `usePathname`, `useSearchParams`, `notFound` and `useRefreshKey`.
 */
import { forwardRef, useSyncExternalStore, type AnchorHTMLAttributes } from 'react';
import {
  Link as RouterLink,
  useLocation,
  useNavigate,
  useSearchParams as useRouterSearchParams,
} from 'react-router';

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  replace?: boolean;
};

/** An in-app link; external or download links stay plain anchors. */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, replace, ...props },
  ref
) {
  if (/^[a-z]+:/i.test(href) || props.download !== undefined) {
    return <a ref={ref} href={href} {...props} />;
  }
  return <RouterLink ref={ref} to={href} replace={replace} {...props} />;
});

/* Data refresh: pages load their data with `useEngine`, which reloads when this counter moves. */
let refreshKey = 0;
const listeners = new Set<() => void>();

export function refreshData() {
  refreshKey += 1;
  listeners.forEach((listener) => listener());
}

export function useRefreshKey(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => refreshKey,
    () => refreshKey
  );
}

export function useRouter() {
  const navigate = useNavigate();
  return {
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href, { replace: true }),
    back: () => navigate(-1),
    /** Reloads the data of the page and the shell (the feed list). */
    refresh: refreshData,
  };
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
  return useRouterSearchParams()[0];
}

export class NotFoundError extends Error {
  constructor() {
    super('not-found');
  }
}

/** Ends the page: the nearest boundary shows the "not found" page. */
export function notFound(): never {
  throw new NotFoundError();
}
