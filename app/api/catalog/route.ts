import { NextResponse } from 'next/server';
import { catalogStatuses } from '@/server/gtfs/catalog';

export async function GET() {
  return NextResponse.json(await catalogStatuses(), {
    // L'estat canvia en hores: el navegador i qualsevol CDN el reaprofiten.
    headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' },
  });
}
