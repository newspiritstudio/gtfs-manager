import type { ZodType } from 'zod';
import { parseGtfsDate } from '@shared/gtfs-values';
import { feedHeader, isUuid } from '@/engine/gtfs/feeds';

export type RouteContext<P> = { params: Promise<P> };

export function jsonError(status: number, code: string, details?: unknown) {
  return Response.json({ error: code, details }, { status });
}

/** The feed from the path (id, name and origin), or a 404 response if it does not exist. */
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

/** A GTFS date from the query (?date=YYYYMMDD), or null. */
export function dateParam(request: Request): string | null {
  const value = new URL(request.url).searchParams.get('date') ?? '';
  // A real date: 20261345 is not one, and Postgres would fail the query with a 500.
  return /^\d{8}$/.test(value) ? parseGtfsDate(value) : null;
}

/** A positive integer from the query (?page=), within [min, max]; the default if it is not one. */
export function intParam(
  request: Request,
  name: string,
  options: { fallback: number; min: number; max: number }
): number {
  const n = Math.floor(Number(new URL(request.url).searchParams.get(name)));
  if (!Number.isFinite(n) || n === 0) return options.fallback;
  return Math.min(options.max, Math.max(options.min, n));
}
