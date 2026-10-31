/**
 * Generador de viatges: a partir d'una línia, unes parades en ordre, els minuts entre parades i una
 * franja amb freqüència, crea els viatges i totes les seves hores de pas (i, si es vol, una shape
 * recta entre parades). És la manera ràpida de fer un feed des de zero.
 */
import type { TripGeneratorInput } from '@shared/contracts';
import { haversineMeters } from '@shared/gtfs-values';
import { planDepartures as plan, planStopTimes, tripIdFor } from '@shared/trip-plan';
import { getSql } from '../db/client';
import { markStatsStale } from './import';

export class GeneratorError extends Error {
  constructor(
    public readonly code:
      | 'unknownRoute'
      | 'unknownService'
      | 'unknownStop'
      | 'tripIdTaken'
      | 'badWindow'
      | 'lengthMismatch'
  ) {
    super(code);
  }
}

export function planDepartures(first: string, last: string, headway: number): number[] {
  const out = plan(first, last, headway);
  if (!out) throw new GeneratorError('badWindow');
  return out;
}

export async function generateTrips(
  feedId: string,
  input: TripGeneratorInput
): Promise<{ trips: number; stopTimes: number }> {
  if (input.travelMinutes.length !== input.stopIds.length)
    throw new GeneratorError('lengthMismatch');
  const departures = planDepartures(
    input.firstDeparture,
    input.lastDeparture,
    input.headwayMinutes
  );
  const sql = getSql();

  const [route] =
    await sql`SELECT 1 FROM routes WHERE feed_id = ${feedId} AND route_id = ${input.routeId}`;
  if (!route) throw new GeneratorError('unknownRoute');
  const [service] = await sql`
    SELECT 1 FROM calendar WHERE feed_id = ${feedId} AND service_id = ${input.serviceId}
    UNION SELECT 1 FROM calendar_dates WHERE feed_id = ${feedId} AND service_id = ${input.serviceId}`;
  if (!service) throw new GeneratorError('unknownService');
  const stops = await sql<{ stopId: string; lat: number | null; lon: number | null }[]>`
    SELECT stop_id AS "stopId", stop_lat AS lat, stop_lon AS lon FROM stops
    WHERE feed_id = ${feedId} AND stop_id = ANY(${input.stopIds})`;
  const stopById = new Map(stops.map((s) => [s.stopId, s]));
  if (input.stopIds.some((id) => !stopById.has(id))) throw new GeneratorError('unknownStop');

  const tripIds = departures.map((d) => tripIdFor(input.tripIdPrefix, d));
  const taken =
    await sql`SELECT trip_id FROM trips WHERE feed_id = ${feedId} AND trip_id = ANY(${tripIds})`;
  if (taken.length) throw new GeneratorError('tripIdTaken');

  const shapeId = input.createShape ? `${input.tripIdPrefix}-shape` : null;
  let stopTimeCount = 0;
  try {
    await sql.begin(async (tx) => {
      if (shapeId) {
        await tx`DELETE FROM shapes WHERE feed_id = ${feedId} AND shape_id = ${shapeId}`;
        let dist = 0;
        let prev: { lat: number; lon: number } | null = null;
        const points = input.stopIds
          .map((id) => stopById.get(id)!)
          .filter((s) => s.lat !== null && s.lon !== null)
          .map((s, i) => {
            if (prev) dist += haversineMeters(prev.lat, prev.lon, s.lat!, s.lon!);
            prev = { lat: s.lat!, lon: s.lon! };
            return {
              feed_id: feedId,
              shape_id: shapeId,
              shape_pt_lat: s.lat!,
              shape_pt_lon: s.lon!,
              shape_pt_sequence: i + 1,
              shape_dist_traveled: Math.round(dist),
            };
          });
        if (points.length > 1) await tx`INSERT INTO shapes ${tx(points)}`;
      }
      const trips = departures.map((_, i) => ({
        feed_id: feedId,
        route_id: input.routeId,
        service_id: input.serviceId,
        trip_id: tripIds[i],
        trip_headsign: input.headsign || null,
        direction_id: input.directionId,
        shape_id: shapeId,
      }));
      await tx`INSERT INTO trips ${tx(trips)}`;
      const rows: Record<string, unknown>[] = [];
      departures.forEach((start, i) => {
        planStopTimes(start, input.travelMinutes, input.dwellMinutes).forEach(
          ([arrival, departure], seq) => {
            const stopId = input.stopIds[seq];
            rows.push({
              feed_id: feedId,
              trip_id: tripIds[i],
              stop_id: stopId,
              stop_sequence: seq + 1,
              arrival_time: arrival,
              departure_time: departure,
              timepoint: 1,
            });
          }
        );
      });
      for (let i = 0; i < rows.length; i += 2000) {
        await tx`INSERT INTO stop_times ${tx(rows.slice(i, i + 2000))}`;
      }
      stopTimeCount = rows.length;
    });
  } catch (error) {
    // Un trip_id agafat per una altra petició entre la comprovació i la inserció.
    if ((error as { code?: string }).code === '23505') throw new GeneratorError('tripIdTaken');
    throw error;
  }
  await markStatsStale(feedId);
  return { trips: departures.length, stopTimes: stopTimeCount };
}
