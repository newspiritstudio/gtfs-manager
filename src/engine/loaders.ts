/**
 * The read functions pages call directly for their data (`useEngine` in `src/lib/engine.ts`).
 * Changes go through the `/api` routes instead, which validate their input.
 */
import { compareList, compareMap, compareSummary } from './gtfs/compare';
import { getRouteDetail, getServices, getStopDetail, getTripDetail } from './gtfs/details';
import { feedHasFares, getFares } from './gtfs/fares';
import { getFeed, importedCatalogFeeds, listFeedNames, listFeeds } from './gtfs/feeds';
import { getRoutePrint, getServiceMap, getStopPrint } from './gtfs/outputs';
import { getNetwork } from './gtfs/network';
import { ensureStats } from './gtfs/stats';
import { getFeedsSafety, getHistoryState } from './history/history';

export const loaders = {
  listFeeds,
  listFeedNames,
  getFeed,
  importedCatalogFeeds,
  ensureStats,
  getServices,
  getNetwork,
  getRouteDetail,
  getStopDetail,
  getTripDetail,
  getHistoryState,
  getFeedsSafety,
  compareSummary,
  compareList,
  compareMap,
  getRoutePrint,
  getStopPrint,
  getServiceMap,
  feedHasFares,
  getFares,
};

export type Loaders = typeof loaders;
export type LoaderName = keyof Loaders;
