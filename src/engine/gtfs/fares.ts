/**
 * Read-only view of a feed's fares, v1 (`fare_attributes`, `fare_rules`) and v2 (products, leg
 * rules between areas and networks, transfer rules, rider categories, media, timeframes).
 */
import { getSql } from '../db/client';

/** Rows shown per list; `total` is the real count. */
const LIMIT = 500;

export interface Limited<T> {
  rows: T[];
  total: number;
}

export interface FaresData {
  attributes: Limited<{
    fareId: string;
    price: string;
    currency: string;
    paymentMethod: number | null;
    transfers: number | null;
    transferDuration: number | null;
    agencyId: string | null;
  }>;
  rules: Limited<{
    fareId: string;
    routeId: string | null;
    originId: string | null;
    destinationId: string | null;
    containsId: string | null;
  }>;
  products: Limited<{
    fareProductId: string;
    name: string | null;
    amount: string;
    currency: string;
    riderCategoryId: string | null;
    riderCategoryName: string | null;
    fareMediaId: string | null;
    fareMediaName: string | null;
  }>;
  legRules: Limited<{
    legGroupId: string | null;
    networkId: string | null;
    networkName: string | null;
    fromAreaId: string | null;
    fromAreaName: string | null;
    toAreaId: string | null;
    toAreaName: string | null;
    fromTimeframeGroupId: string | null;
    toTimeframeGroupId: string | null;
    fareProductId: string;
    fareProductName: string | null;
    rulePriority: number | null;
  }>;
  joinRules: Limited<{
    fromNetworkId: string;
    toNetworkId: string;
    fromStopId: string | null;
    toStopId: string | null;
  }>;
  transferRules: Limited<{
    fromLegGroupId: string | null;
    toLegGroupId: string | null;
    transferCount: number | null;
    durationLimit: number | null;
    durationLimitType: number | null;
    fareTransferType: number;
    fareProductId: string | null;
    fareProductName: string | null;
  }>;
  riderCategories: Limited<{
    riderCategoryId: string;
    name: string;
    isDefault: number | null;
    eligibilityUrl: string | null;
  }>;
  media: Limited<{ fareMediaId: string; name: string | null; type: number }>;
  timeframes: Limited<{
    groupId: string;
    startTime: number | null;
    endTime: number | null;
    serviceId: string;
  }>;
}

/** Whether the feed has any fare file; cheap, the side navigation asks it for every feed. */
export async function feedHasFares(feedId: string): Promise<boolean> {
  if (!feedId) return false;
  const [row] = await getSql()<{ found: number }[]>`
    SELECT (EXISTS (SELECT 1 FROM fare_attributes WHERE feed_id = ${feedId})
         OR EXISTS (SELECT 1 FROM fare_products WHERE feed_id = ${feedId})
         OR EXISTS (SELECT 1 FROM fare_leg_rules WHERE feed_id = ${feedId})
         OR EXISTS (SELECT 1 FROM fare_transfer_rules WHERE feed_id = ${feedId})
         OR EXISTS (SELECT 1 FROM fare_rules WHERE feed_id = ${feedId})) AS found`;
  return Boolean(row?.found);
}

async function count(table: string, feedId: string): Promise<number> {
  const [row] = await getSql().unsafe<{ n: number }[]>(
    `SELECT count(*) AS n FROM ${table} WHERE feed_id = $1`,
    [feedId]
  );
  return row.n;
}

async function limited<T>(
  table: string,
  feedId: string,
  rows: PromiseLike<unknown[]>
): Promise<Limited<T>> {
  const list = (await rows) as T[];
  return { rows: list, total: await count(table, feedId) };
}

export async function getFares(feedId: string): Promise<FaresData> {
  const sql = getSql();
  // Sequential on purpose: one database connection, and the lists are small.
  const attributes = await limited<FaresData['attributes']['rows'][number]>(
    'fare_attributes',
    feedId,
    sql`SELECT fare_id AS "fareId", price, currency_type AS currency,
               payment_method AS "paymentMethod", transfers,
               transfer_duration AS "transferDuration", agency_id AS "agencyId"
        FROM fare_attributes WHERE feed_id = ${feedId} ORDER BY fare_id LIMIT ${LIMIT}`
  );
  const rules = await limited<FaresData['rules']['rows'][number]>(
    'fare_rules',
    feedId,
    sql`SELECT fare_id AS "fareId", route_id AS "routeId", origin_id AS "originId",
               destination_id AS "destinationId", contains_id AS "containsId"
        FROM fare_rules WHERE feed_id = ${feedId} ORDER BY fare_id, id LIMIT ${LIMIT}`
  );
  const products = await limited<FaresData['products']['rows'][number]>(
    'fare_products',
    feedId,
    sql`SELECT p.fare_product_id AS "fareProductId", p.fare_product_name AS name, p.amount,
               p.currency, p.rider_category_id AS "riderCategoryId",
               (SELECT c.rider_category_name FROM rider_categories c
                WHERE c.feed_id = p.feed_id AND c.rider_category_id = p.rider_category_id)
                 AS "riderCategoryName",
               p.fare_media_id AS "fareMediaId",
               (SELECT m.fare_media_name FROM fare_media m
                WHERE m.feed_id = p.feed_id AND m.fare_media_id = p.fare_media_id)
                 AS "fareMediaName"
        FROM fare_products p WHERE p.feed_id = ${feedId}
        ORDER BY p.fare_product_id, p.id LIMIT ${LIMIT}`
  );
  const legRules = await limited<FaresData['legRules']['rows'][number]>(
    'fare_leg_rules',
    feedId,
    sql`SELECT r.leg_group_id AS "legGroupId", r.network_id AS "networkId",
               (SELECT n.network_name FROM networks n
                WHERE n.feed_id = r.feed_id AND n.network_id = r.network_id) AS "networkName",
               r.from_area_id AS "fromAreaId",
               (SELECT a.area_name FROM areas a
                WHERE a.feed_id = r.feed_id AND a.area_id = r.from_area_id) AS "fromAreaName",
               r.to_area_id AS "toAreaId",
               (SELECT a.area_name FROM areas a
                WHERE a.feed_id = r.feed_id AND a.area_id = r.to_area_id) AS "toAreaName",
               r.from_timeframe_group_id AS "fromTimeframeGroupId",
               r.to_timeframe_group_id AS "toTimeframeGroupId",
               r.fare_product_id AS "fareProductId",
               (SELECT p.fare_product_name FROM fare_products p
                WHERE p.feed_id = r.feed_id AND p.fare_product_id = r.fare_product_id
                ORDER BY p.id LIMIT 1) AS "fareProductName",
               r.rule_priority AS "rulePriority"
        FROM fare_leg_rules r WHERE r.feed_id = ${feedId}
        ORDER BY r.rule_priority DESC, r.id LIMIT ${LIMIT}`
  );
  const joinRules = await limited<FaresData['joinRules']['rows'][number]>(
    'fare_leg_join_rules',
    feedId,
    sql`SELECT from_network_id AS "fromNetworkId", to_network_id AS "toNetworkId",
               from_stop_id AS "fromStopId", to_stop_id AS "toStopId"
        FROM fare_leg_join_rules WHERE feed_id = ${feedId} ORDER BY id LIMIT ${LIMIT}`
  );
  const transferRules = await limited<FaresData['transferRules']['rows'][number]>(
    'fare_transfer_rules',
    feedId,
    sql`SELECT r.from_leg_group_id AS "fromLegGroupId", r.to_leg_group_id AS "toLegGroupId",
               r.transfer_count AS "transferCount", r.duration_limit AS "durationLimit",
               r.duration_limit_type AS "durationLimitType",
               r.fare_transfer_type AS "fareTransferType", r.fare_product_id AS "fareProductId",
               (SELECT p.fare_product_name FROM fare_products p
                WHERE p.feed_id = r.feed_id AND p.fare_product_id = r.fare_product_id
                ORDER BY p.id LIMIT 1) AS "fareProductName"
        FROM fare_transfer_rules r WHERE r.feed_id = ${feedId} ORDER BY r.id LIMIT ${LIMIT}`
  );
  const riderCategories = await limited<FaresData['riderCategories']['rows'][number]>(
    'rider_categories',
    feedId,
    sql`SELECT rider_category_id AS "riderCategoryId", rider_category_name AS name,
               is_default_fare_category AS "isDefault", eligibility_url AS "eligibilityUrl"
        FROM rider_categories WHERE feed_id = ${feedId} ORDER BY rider_category_id LIMIT ${LIMIT}`
  );
  const media = await limited<FaresData['media']['rows'][number]>(
    'fare_media',
    feedId,
    sql`SELECT fare_media_id AS "fareMediaId", fare_media_name AS name, fare_media_type AS type
        FROM fare_media WHERE feed_id = ${feedId} ORDER BY fare_media_id LIMIT ${LIMIT}`
  );
  const timeframes = await limited<FaresData['timeframes']['rows'][number]>(
    'timeframes',
    feedId,
    sql`SELECT timeframe_group_id AS "groupId", start_time AS "startTime", end_time AS "endTime",
               service_id AS "serviceId"
        FROM timeframes WHERE feed_id = ${feedId} ORDER BY timeframe_group_id, start_time, id
        LIMIT ${LIMIT}`
  );
  return {
    attributes,
    rules,
    products,
    legRules,
    joinRules,
    transferRules,
    riderCategories,
    media,
    timeframes,
  };
}
