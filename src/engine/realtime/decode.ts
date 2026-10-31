/**
 * Decodes GTFS Realtime protobuf messages. `gtfs-realtime.json` is the protobufjs descriptor of
 * the official `gtfs-realtime.proto` (vendored next to it, Apache-2.0). To update both, replace
 * the .proto with the one from https://github.com/google/transit and run
 * `npm run realtime:proto`.
 */
import protobuf from 'protobufjs';
import descriptor from './gtfs-realtime.json';

const root = protobuf.Root.fromJSON(descriptor as protobuf.INamespace);
const FeedMessage = root.lookupType('transit_realtime.FeedMessage');

interface TranslatedString {
  translation?: { text?: string; language?: string }[];
}

interface TripDescriptor {
  tripId?: string;
  routeId?: string;
  directionId?: number;
  startTime?: string;
  startDate?: string;
  scheduleRelationship?: string;
}

interface StopTimeEvent {
  delay?: number;
  time?: number;
  uncertainty?: number;
}

/** The decoded message, with only the fields the app reads (protobufjs `toObject` shape). */
export interface DecodedFeedMessage {
  header?: { gtfsRealtimeVersion?: string; incrementality?: string; timestamp?: number };
  entity?: {
    id?: string;
    isDeleted?: boolean;
    tripUpdate?: {
      trip?: TripDescriptor;
      vehicle?: { id?: string; label?: string };
      stopTimeUpdate?: {
        stopSequence?: number;
        stopId?: string;
        arrival?: StopTimeEvent;
        departure?: StopTimeEvent;
        scheduleRelationship?: string;
      }[];
      timestamp?: number;
      delay?: number;
    };
    vehicle?: {
      trip?: TripDescriptor;
      vehicle?: { id?: string; label?: string };
      position?: { latitude?: number; longitude?: number; bearing?: number; speed?: number };
      currentStopSequence?: number;
      stopId?: string;
      currentStatus?: string;
      timestamp?: number;
      occupancyStatus?: string;
    };
    alert?: {
      activePeriod?: { start?: number; end?: number }[];
      informedEntity?: {
        agencyId?: string;
        routeId?: string;
        stopId?: string;
        trip?: TripDescriptor;
      }[];
      cause?: string;
      effect?: string;
      url?: TranslatedString;
      headerText?: TranslatedString;
      descriptionText?: TranslatedString;
      severityLevel?: string;
    };
  }[];
}

const toObject = (message: protobuf.Message) =>
  FeedMessage.toObject(message, {
    longs: Number,
    enums: String,
    defaults: false,
  }) as DecodedFeedMessage;

/**
 * Thrown when the message parses but lacks a field the proto marks as required. protobufjs
 * stops at the first one, in whichever nested message it is, so nothing else can be read.
 */
export class MissingFieldsError extends Error {
  constructor(readonly field: string) {
    super(`missing required ${field}`);
  }
}

export function decodeFeedMessage(body: Uint8Array): DecodedFeedMessage {
  try {
    return toObject(FeedMessage.decode(body));
  } catch (error) {
    if (error instanceof protobuf.util.ProtocolError) {
      const field = /missing required '([^']+)'/.exec(error.message)?.[1] ?? error.message;
      throw new MissingFieldsError(field);
    }
    throw error;
  }
}
