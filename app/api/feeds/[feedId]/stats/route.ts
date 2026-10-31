import { NextResponse } from 'next/server';
import { finishImport } from '@/server/gtfs/feeds';
import { ensureStats } from '@/server/gtfs/stats';
import { requireFeed, type RouteContext } from '@/server/http';

export const maxDuration = 300;

export async function GET(_request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  return response ?? NextResponse.json(await ensureStats(feedId));
}

/** Finishes an import and recomputes the figures and validation. */
export async function POST(_request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { feed, response } = await requireFeed(feedId);
  if (response) return response;
  if (feed.origin === 'import') await finishImport(feedId);
  return NextResponse.json(await ensureStats(feedId));
}
