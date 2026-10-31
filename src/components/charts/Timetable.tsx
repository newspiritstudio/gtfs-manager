'use client';

import Link from 'next/link';
import type { DayTrip, PatternStop } from '@shared/contracts';
import { formatClock } from '@shared/gtfs-values';

/** Timetable: one row per stop and one column per trip, with a fixed first column. */
export default function Timetable({
  stops,
  trips,
  feedId,
  tripLabel,
}: {
  stops: PatternStop[];
  trips: DayTrip[];
  feedId: string;
  tripLabel: string;
}) {
  const columns = trips.map((trip) => {
    const byStop = new Map<string, number | null>();
    for (const [stopId, arr, dep] of trip.times)
      if (!byStop.has(stopId)) byStop.set(stopId, dep ?? arr);
    return { trip, byStop };
  });
  return (
    <div
      role="region"
      aria-label={tripLabel}
      tabIndex={0}
      className="max-h-[70vh] overflow-auto rounded-md focus-ring"
    >
      <table className="border-separate border-spacing-0 text-body-small tabular-nums">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 top-0 z-20 min-w-48 bg-surface-container-high px-3 py-2 text-left text-label-medium text-on-surface-variant"
            >
              {tripLabel}
            </th>
            {columns.map(({ trip }, index) => (
              <th
                scope="col"
                key={trip.tripId}
                className="sticky top-0 z-10 bg-surface-container-high px-2 py-2 text-label-small font-medium text-on-surface-variant"
              >
                <Link
                  href={`/feeds/${feedId}/trips/${encodeURIComponent(trip.tripId)}`}
                  className="block max-w-20 truncate rounded-xs hover:text-primary focus-ring"
                  title={trip.tripId}
                >
                  {/* A long identifier (a hash) says nothing in the header: use the ordinal instead. */}
                  {trip.tripId.length <= 8 ? trip.tripId : `#${index + 1}`}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stops.map((stop, i) => (
            <tr key={`${stop.stopId}-${i}`} className="group">
              <th
                scope="row"
                className="sticky left-0 z-10 max-w-64 truncate bg-surface-container px-3 py-1.5 text-left font-normal text-on-surface group-hover:bg-surface-container-highest"
              >
                {stop.name ?? stop.stopId}
              </th>
              {columns.map(({ trip, byStop }) => {
                const time = byStop.get(stop.stopId);
                return (
                  <td
                    key={trip.tripId}
                    className="px-2 py-1.5 text-center text-on-surface group-hover:bg-surface-container-highest"
                  >
                    {time === undefined ? (
                      <span className="text-on-surface-muted">·</span>
                    ) : time === null ? (
                      '|'
                    ) : (
                      formatClock(time)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
