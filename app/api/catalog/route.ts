import { NextResponse } from 'next/server';
import { catalogStatuses } from '@/server/gtfs/catalog';

export async function GET() {
  return NextResponse.json(await catalogStatuses());
}
