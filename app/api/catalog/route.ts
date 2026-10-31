import { NextResponse } from 'next/server';
import { catalogStatuses } from '@/server/gtfs/catalog';

export async function GET() {
  return NextResponse.json(await catalogStatuses(), {
    // The status changes over hours: the browser and any CDN can reuse it.
    headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' },
  });
}
