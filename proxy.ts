import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from '@/lib/i18n/config';

/** Header the proxy uses to tell pages which locale to render. */
const LOCALE_HEADER = 'x-gtfs-locale';

/**
 * Locale-prefixed paths (`/ca`, `/de/catalog/fgc`) render in that locale and keep it selected
 * for the rest of the app. `/en/...` redirects to the unprefixed path.
 */
export function proxy(request: NextRequest) {
  const [, first, ...rest] = request.nextUrl.pathname.split('/');
  if (!isLocale(first)) return NextResponse.next();
  if (first === DEFAULT_LOCALE) {
    const url = request.nextUrl.clone();
    url.pathname = `/${rest.join('/')}`;
    return NextResponse.redirect(url, 308);
  }
  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, first);
  const response = NextResponse.next({ request: { headers } });
  // A prefetch is not a choice: only a page the visitor actually opens keeps its language.
  const prefetch =
    request.headers.has('next-router-prefetch') ||
    /prefetch/i.test(request.headers.get('sec-purpose') ?? request.headers.get('purpose') ?? '');
  if (!prefetch && request.cookies.get(LOCALE_COOKIE)?.value !== first) {
    response.cookies.set(LOCALE_COOKIE, first, {
      path: '/',
      maxAge: 31536000,
      sameSite: 'lax',
    });
  }
  return response;
}

// Must be a literal: Next reads it at compile time. Same locales as `LOCALES`.
export const config = {
  matcher: [
    '/(ca|es|en|fr|de|it|pt|zh|ja)',
    '/(ca|es|en|fr|de|it|pt|zh|ja)/catalog',
    '/(ca|es|en|fr|de|it|pt|zh|ja)/catalog/:path*',
  ],
};
