import { NextResponse } from 'next/server';
import { realtimeSourcesSchema } from '@shared/realtime';
import { parseBody, requireFeed, type RouteContext } from '@/server/http';
import {
  getRealtimeConfig,
  getRealtimeSnapshot,
  setRealtimeSources,
} from '@/server/realtime/snapshot';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** The feed's realtime configuration and, when it has sources, its current snapshot. */
export async function GET(_request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const [config, snapshot] = await Promise.all([
    getRealtimeConfig(feedId),
    getRealtimeSnapshot(feedId),
  ]);
  return NextResponse.json({ config, snapshot }, { headers: NO_STORE });
}

/** Sets the feed's own realtime sources; `{}` clears them (the catalog's apply again, if any). */
export async function PUT(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, realtimeSourcesSchema);
  if (body.response) return body.response;
  await setRealtimeSources(feedId, body.data);
  return NextResponse.json({ config: await getRealtimeConfig(feedId) }, { headers: NO_STORE });
}
