import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { parseGtfsDate } from '@shared/gtfs-values';
import { feedHeader, isUuid } from './gtfs/feeds';

export type RouteContext<P> = { params: Promise<P> };

export function jsonError(status: number, code: string, details?: unknown) {
  return NextResponse.json({ error: code, details }, { status });
}

/** El feed del camí (id, nom i origen), o una resposta 404 si no existeix. */
export async function requireFeed(feedId: string) {
  if (!isUuid(feedId)) return { feed: null, response: jsonError(404, 'feedNotFound') } as const;
  const feed = await feedHeader(feedId);
  if (!feed) return { feed: null, response: jsonError(404, 'feedNotFound') } as const;
  return { feed, response: null } as const;
}

export async function parseBody<T>(request: Request, schema: ZodType<T>) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { data: null, response: jsonError(400, 'invalidJson') } as const;
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    return { data: null, response: jsonError(400, 'invalidBody', result.error.issues) } as const;
  }
  return { data: result.data, response: null } as const;
}

/** Una data GTFS de la query (?date=AAAAMMDD), o null. */
export function dateParam(request: Request): string | null {
  const value = new URL(request.url).searchParams.get('date') ?? '';
  // Una data real: 20261345 no ho és i Postgres tombaria la consulta amb un 500.
  return /^\d{8}$/.test(value) ? parseGtfsDate(value) : null;
}

/** Un enter positiu de la query (?page=), dins de [min, max]; si no ho és, el valor per defecte. */
export function intParam(
  request: Request,
  name: string,
  options: { fallback: number; min: number; max: number }
): number {
  const n = Math.floor(Number(new URL(request.url).searchParams.get(name)));
  if (!Number.isFinite(n) || n === 0) return options.fallback;
  return Math.min(options.max, Math.max(options.min, n));
}
