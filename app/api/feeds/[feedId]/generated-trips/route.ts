import { NextResponse } from 'next/server';
import { tripGeneratorSchema } from '@shared/contracts';
import { GeneratorError, generateTrips } from '@/server/gtfs/generator';
import { jsonError, parseBody, requireFeed, type RouteContext } from '@/server/http';

export async function POST(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, tripGeneratorSchema);
  if (body.response) return body.response;
  try {
    return NextResponse.json(await generateTrips(feedId, body.data), { status: 201 });
  } catch (error) {
    if (error instanceof GeneratorError) return jsonError(422, error.code);
    throw error;
  }
}
