import { NextResponse } from 'next/server';
import { EDITOR_COOKIE } from '@/lib/editor-config';

/**
 * Editing mode. The proxy asks for the editor's password before this is reached (see
 * deploy/Caddyfile.gtfs); the browser then sends it with every change too. `?exit` leaves.
 * Relative redirects: behind the proxy, the request URL carries the container's address.
 */
export function GET(request: Request) {
  const exit = new URL(request.url).searchParams.has('exit');
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: exit ? '/' : '/feeds', 'Cache-Control': 'no-store' },
  });
  if (exit) response.cookies.delete(EDITOR_COOKIE);
  else
    response.cookies.set(EDITOR_COOKIE, '1', {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });
  return response;
}
