/**
 * Map edits: moving a stop, and drawing a shape for a pattern. A shape is saved as plain points
 * (no routing service), `shape_dist_traveled` is recomputed when the feed uses it, and the shape
 * is assigned to the pattern's trips.
 */
import type { ShapeData, ShapeSave } from '@shared/editing';
import { haversineMeters } from '@shared/gtfs-values';
import { cumulativeDistances, distancesAlongShape } from '@shared/shape-geometry';
import { getSql } from '../db/client';
import type { Sql } from '../db/sql';
import { markStatsStale } from './import';
import { findPatternGroup } from './patterns';

export class GeometryError extends Error {
  constructor(public readonly code: 'unknownStop' | 'shapeIdTaken') {
    super(code);
  }
}

/** Moves a stop; returns its name and how far it moved, in meters (for the step's text). */
export async function moveStop(
  sql: Sql,
  feedId: string,
  stopId: string,
  lat: number,
  lon: number
): Promise<{ name: string | null; meters: number }> {
  const [stop] = await sql<{ name: string | null; lat: number | null; lon: number | null }[]>`
    SELECT stop_name AS name, stop_lat AS lat, stop_lon AS lon FROM stops
    WHERE feed_id = ${feedId} AND stop_id = ${stopId}`;
  if (!stop) throw new GeometryError('unknownStop');
  await sql`UPDATE stops SET stop_lat = ${lat}, stop_lon = ${lon}
    WHERE feed_id = ${feedId} AND stop_id = ${stopId}`;
  await markStatsStale(feedId);
  const meters =
    stop.lat !== null && stop.lon !== null ? haversineMeters(stop.lat, stop.lon, lat, lon) : 0;
  return { name: stop.name, meters: Math.round(meters) };
}

/** A shape's points and how many trips use it. */
export async function getShape(
  feedId: string,
  shapeId: string
): Promise<(ShapeData & { trips: number }) | null> {
  const sql = getSql();
  const points = await sql<{ lat: number; lon: number }[]>`
    SELECT shape_pt_lat AS lat, shape_pt_lon AS lon FROM shapes
    WHERE feed_id = ${feedId} AND shape_id = ${shapeId} ORDER BY shape_pt_sequence`;
  if (!points.length) return null;
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*) AS n FROM trips WHERE feed_id = ${feedId} AND shape_id = ${shapeId}`;
  return { shapeId, points: points.map((p) => [p.lat, p.lon]), trips: n };
}

/** Whether the feed fills `shape_dist_traveled` anywhere (then the new shape has to as well). */
async function usesDistances(sql: Sql, feedId: string): Promise<boolean> {
  const [row] = await sql<{ n: number }[]>`
    SELECT (SELECT count(*) FROM (SELECT 1 FROM shapes
              WHERE feed_id = ${feedId} AND shape_dist_traveled IS NOT NULL LIMIT 1))
         + (SELECT count(*) FROM (SELECT 1 FROM stop_times
              WHERE feed_id = ${feedId} AND shape_dist_traveled IS NOT NULL LIMIT 1)) AS n`;
  return row.n > 0;
}

/**
 * Writes the shape (replacing any shape with that id) and assigns it to every trip of the
 * pattern. With distances in use, `shape_dist_traveled` of the shape and of the pattern's stop
 * times is recomputed.
 */
export async function savePatternShape(
  sql: Sql,
  feedId: string,
  routeId: string,
  key: string,
  input: ShapeSave
): Promise<{ points: number; trips: number }> {
  const group = await findPatternGroup(sql, feedId, routeId, key);
  const tripIds = group.trips.map((t) => t.tripId);
  // A shape id another route uses must not be overwritten by accident.
  const [foreign] = await sql<{ n: number }[]>`
    SELECT count(*) AS n FROM trips
    WHERE feed_id = ${feedId} AND shape_id = ${input.shapeId}
      AND trip_id NOT IN (SELECT value FROM json_each(${tripIds})) AND route_id <> ${routeId}`;
  if (foreign.n) throw new GeometryError('shapeIdTaken');
  const withDistances = await usesDistances(sql, feedId);
  const cum = withDistances ? cumulativeDistances(input.points) : null;
  await sql`DELETE FROM shapes WHERE feed_id = ${feedId} AND shape_id = ${input.shapeId}`;
  const rows = input.points.map(([lat, lon], i) => ({
    feed_id: feedId,
    shape_id: input.shapeId,
    shape_pt_lat: lat,
    shape_pt_lon: lon,
    shape_pt_sequence: i + 1,
    shape_dist_traveled: cum ? Math.round(cum[i] * 10) / 10 : null,
  }));
  for (let i = 0; i < rows.length; i += 2000)
    await sql`INSERT INTO shapes ${sql(rows.slice(i, i + 2000))}`;
  for (let i = 0; i < tripIds.length; i += 2000)
    await sql.unsafe(
      `UPDATE trips SET shape_id = $3
       WHERE feed_id = $1 AND trip_id IN (SELECT value FROM json_each($2))`,
      [feedId, JSON.stringify(tripIds.slice(i, i + 2000)), input.shapeId]
    );
  if (withDistances && group.trips.length) {
    const stops = await sql<{ id: string; lat: number | null; lon: number | null }[]>`
      SELECT stop_id AS id, stop_lat AS lat, stop_lon AS lon FROM stops
      WHERE feed_id = ${feedId} AND stop_id IN (SELECT value FROM json_each(${group.stopIds}))`;
    const at = new Map(stops.map((s) => [s.id, s]));
    const dist = distancesAlongShape(
      input.points,
      group.stopIds.map((id) => at.get(id) ?? { lat: null, lon: null })
    );
    // Every trip of the pattern has the same stops in the same order: position i gets dist[i].
    const positions = await sql<{ id: number }[]>`
      SELECT id FROM stop_times WHERE feed_id = ${feedId}
        AND trip_id IN (SELECT value FROM json_each(${tripIds}))
      ORDER BY trip_id, stop_sequence`;
    const n = group.stopIds.length;
    for (let i = 0; i < positions.length; i += 1) {
      await sql`UPDATE stop_times SET shape_dist_traveled = ${dist[i % n]} WHERE id = ${positions[i].id}`;
    }
  }
  await markStatsStale(feedId);
  return { points: input.points.length, trips: tripIds.length };
}
