import { DeletionError } from '@/engine/gtfs/integrity';
import { FrequencyError } from '@/engine/gtfs/frequencies';
import { GeometryError } from '@/engine/gtfs/geometry';
import { PatternError } from '@/engine/gtfs/patterns';
import { TimetableError } from '@/engine/gtfs/timetable';
import { jsonError } from './http';

/** The response for an error the editing code throws on purpose; `null` for any other error. */
export function editingErrorResponse(error: unknown): Response | null {
  if (error instanceof PatternError)
    return jsonError(error.code === 'patternNotFound' ? 404 : 422, error.code);
  if (error instanceof TimetableError)
    return jsonError(error.code === 'unknownTrip' ? 404 : 422, error.code);
  if (error instanceof GeometryError)
    return jsonError(error.code === 'unknownStop' ? 404 : 409, error.code);
  if (error instanceof DeletionError || error instanceof FrequencyError)
    return jsonError(422, error.code);
  if ((error as { code?: string }).code === 'tripIdTaken') return jsonError(409, 'tripIdTaken');
  return null;
}

/** Runs a handler body, answering the editing errors above instead of failing with a 500. */
export async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const response = editingErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
