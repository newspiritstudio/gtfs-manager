/** Contracts of the operator outputs: printable timetables and the frequency and coverage map. */
import type { StopDeparture } from './contracts';

export interface PrintValidity {
  start: string;
  end: string;
}

export interface PrintTrip {
  tripId: string;
  headsign: string | null;
  /** Time at each stop of the direction (seconds); null where the trip does not call. */
  times: (number | null)[];
}

export interface PrintDirection {
  directionId: number | null;
  /** The usual headsign of the direction. */
  headsign: string | null;
  stops: { stopId: string; name: string | null }[];
  trips: PrintTrip[];
}

export interface RoutePrint {
  feedName: string;
  route: {
    routeId: string;
    shortName: string | null;
    longName: string | null;
    color: string;
    textColor: string;
    agencyName: string | null;
  };
  date: string;
  validity: PrintValidity | null;
  directions: PrintDirection[];
}

export interface StopPrint {
  feedName: string;
  stop: {
    stopId: string;
    name: string | null;
    code: string | null;
    platformCode: string | null;
  };
  date: string;
  validity: PrintValidity | null;
  /** The departures of the day (the stop's platforms included), without the trips that end here. */
  departures: StopDeparture[];
}

export interface ServiceSegment {
  a: [number, number];
  b: [number, number];
  /** Trips per hour in the window, in the busier direction. */
  perHour: number;
}

export interface ServiceStop {
  stopId: string;
  name: string | null;
  lat: number;
  lon: number;
  /** Trips calling here in the window. */
  calls: number;
}

export interface ServiceMapData {
  segments: ServiceSegment[];
  stops: ServiceStop[];
  /** [south, west, north, east] of what is drawn. */
  bbox: [number, number, number, number] | null;
}
