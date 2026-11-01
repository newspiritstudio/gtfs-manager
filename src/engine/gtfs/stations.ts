/**
 * The structure of a station: its levels, the locations inside it (platforms, entrances, generic
 * nodes, boarding areas) and the pathways that link them (`pathways.txt`, `levels.txt`).
 */
import { getSql } from '../db/client';

export interface StationNode {
  stopId: string;
  name: string | null;
  /** 0 platform, 2 entrance/exit, 3 generic node, 4 boarding area (the station itself is 1). */
  locationType: number;
  levelId: string | null;
  platformCode: string | null;
  wheelchairBoarding: number | null;
  parentStation: string | null;
}

export interface StationPathway {
  pathwayId: string;
  fromStopId: string;
  toStopId: string;
  mode: number | null;
  bidirectional: number | null;
  length: number | null;
  traversalTime: number | null;
  stairCount: number | null;
  maxSlope: number | null;
  minWidth: number | null;
  signpostedAs: string | null;
  reversedSignpostedAs: string | null;
}

export interface StationStructure {
  station: { stopId: string; name: string | null; levelId: string | null };
  levels: { levelId: string; index: number | null; name: string | null }[];
  nodes: StationNode[];
  pathways: StationPathway[];
}

/**
 * The structure of a station, or null if the stop is not a station or has neither locations nor
 * pathways inside it.
 */
export async function getStationStructure(
  feedId: string,
  stopId: string
): Promise<StationStructure | null> {
  const sql = getSql();
  const [station] = await sql<StationStructure['station'][]>`
    SELECT stop_id AS "stopId", stop_name AS name, level_id AS "levelId"
    FROM stops WHERE feed_id = ${feedId} AND stop_id = ${stopId} AND location_type = 1`;
  if (!station) return null;
  // Platforms, entrances and generic nodes belong to the station; boarding areas to a platform.
  const nodes = await sql<StationNode[]>`
    SELECT stop_id AS "stopId", stop_name AS name, coalesce(location_type, 0) AS "locationType",
           level_id AS "levelId", platform_code AS "platformCode",
           wheelchair_boarding AS "wheelchairBoarding", parent_station AS "parentStation"
    FROM stops
    WHERE feed_id = ${feedId}
      AND (parent_station = ${stopId}
           OR parent_station IN (SELECT stop_id FROM stops
                                 WHERE feed_id = ${feedId} AND parent_station = ${stopId}))
    ORDER BY location_type, platform_code, stop_name, stop_id`;
  const ids = [stopId, ...nodes.map((n) => n.stopId)];
  const pathways = await sql<StationPathway[]>`
    SELECT pathway_id AS "pathwayId", from_stop_id AS "fromStopId", to_stop_id AS "toStopId",
           pathway_mode AS mode, is_bidirectional AS bidirectional, length,
           traversal_time AS "traversalTime", stair_count AS "stairCount", max_slope AS "maxSlope",
           min_width AS "minWidth", signposted_as AS "signpostedAs",
           reversed_signposted_as AS "reversedSignpostedAs"
    FROM pathways
    WHERE feed_id = ${feedId}
      AND (from_stop_id IN (SELECT value FROM json_each(${ids}))
           OR to_stop_id IN (SELECT value FROM json_each(${ids})))
    ORDER BY pathway_id`;
  if (!nodes.length && !pathways.length) return null;
  const levelIds = [
    ...new Set([station.levelId, ...nodes.map((n) => n.levelId)].filter((v): v is string => !!v)),
  ];
  const levels = await sql<StationStructure['levels']>`
    SELECT level_id AS "levelId", level_index AS "index", level_name AS name
    FROM levels WHERE feed_id = ${feedId}
      AND level_id IN (SELECT value FROM json_each(${levelIds}))
    ORDER BY level_index DESC, level_id`;
  // A level a stop mentions but levels.txt lacks is still listed, so no node is left out.
  for (const levelId of levelIds) {
    if (!levels.some((l) => l.levelId === levelId))
      levels.push({ levelId, index: null, name: null });
  }
  return { station, levels, nodes, pathways };
}
