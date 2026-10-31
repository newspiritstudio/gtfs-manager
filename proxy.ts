import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from '@/lib/i18n/config';

/** Capçalera amb què el proxy diu a les pàgines en quin idioma s'han de pintar. */
const LOCALE_HEADER = 'x-gtfs-locale';

/**
 * Les adreces amb prefix d'idioma (`/ca`, `/de/catalog/fgc`) es pinten en aquell idioma i el
 * deixen triat per a la resta de l'aplicació. `/en/...` torna a l'adreça sense prefix.
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
  if (request.cookies.get(LOCALE_COOKIE)?.value !== first) {
    response.cookies.set(LOCALE_COOKIE, first, {
      path: '/',
      maxAge: 31536000,
      sameSite: 'lax',
    });
  }
  return response;
}

// Ha de ser literal: Next el llegeix en compilar. Els mateixos idiomes que `LOCALES`.
export const config = {
  matcher: [
    '/(ca|es|en|fr|de|it|pt|zh|ja)',
    '/(ca|es|en|fr|de|it|pt|zh|ja)/catalog',
    '/(ca|es|en|fr|de|it|pt|zh|ja)/catalog/:path*',
  ],
};
