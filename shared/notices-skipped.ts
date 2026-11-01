/**
 * The notices of the canonical validator that GTFS Manager does not raise, each with the reason:
 * the code is in the catalog (`shared/notices.ts`) but nothing computes it.
 */
import { NOTICE_CATALOG } from './notices';

/** A notice the browser cannot (or does not yet) raise, with the reason. */
export const SKIPPED_NOTICES: Readonly<Record<string, string>> = {
  // Deprecated in the canonical validator: it no longer emits them.
  fare_transfer_rule_missing_transfer_count: 'deprecated in the canonical validator',
  missing_prior_day_booking_field_value: 'deprecated in the canonical validator',
  missing_recommended_column: 'deprecated in the canonical validator',
  unused_parent_station: 'deprecated in the canonical validator',
  // Java runtime or command line.
  i_o_error: 'Java I/O; the browser reads files from memory',
  runtime_exception_in_loader_error: 'Java exception while loading a file',
  runtime_exception_in_validator_error: 'Java exception inside a validator',
  thread_execution_error: 'Java thread pool error',
  u_r_i_syntax_error: 'Java URI parsing of the input path',
  too_many_rows: 'the validator only raises it above its row limit; the browser has no such limit',
  // Needs something the browser does not have.
  invalid_phone_number: 'needs the feed country code, which the browser is not given',
  invalid_input_files_in_subfolder:
    'the importer flattens ZIP entries before the engine sees them (NewFeedForm.pickZip)',
  geo_json_duplicated_element: 'JSON.parse cannot tell a repeated key from the last one',
  invalid_geometry: 'needs a polygon validity test (JTS IsValidOp), not available in the browser',
  // Computable from the feed but not implemented yet (they need a per-trip geometry pass).
  fast_travel_between_far_stops: 'not implemented: pairwise distance between far stops of a trip',
  stop_too_far_from_shape: 'not implemented: stop-to-shape matching (canonical geometry matcher)',
  stop_too_far_from_shape_using_user_distance: 'not implemented: stop-to-shape matching',
  stops_match_shape_out_of_order: 'not implemented: stop-to-shape matching',
  stop_has_too_many_matches_for_shape: 'not implemented: stop-to-shape matching',
  pathway_unreachable_location: 'not implemented: pathway graph reachability',
  overlapping_zone_and_pickup_drop_off_window: 'not implemented: needs polygon intersection',
};

/** The skipped notices the canonical validator still emits (the deprecated ones do not count). */
export const SKIPPED_NOTICE_COUNT = Object.keys(SKIPPED_NOTICES).filter(
  (code) => !NOTICE_CATALOG[code]?.deprecated
).length;
