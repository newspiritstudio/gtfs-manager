/**
 * The read functions pages call directly for their data (`useEngine` in `src/lib/engine.ts`).
 * Changes go through the `/api` routes instead, which validate their input.
 */
import { compareList, compareMap, compareSummary } from './gtfs/compare';
import { getRouteDetail, getServices, getStopDetail, getTripDetail } from './gtfs/details';
import { getFeed, importedCatalogFeeds, listFeedNames, listFeeds } from './gtfs/feeds';
import { getRoutePrint, getServiceMap, getStopPrint } from './gtfs/outputs';
import { getNetwork } from './gtfs/network';
import { ensureStats } from './gtfs/stats';

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
  compareSummary,
  compareList,
  compareMap,
  getRoutePrint,
  getStopPrint,
  getServiceMap,
};

export type Loaders = typeof loaders;
export type LoaderName = keyof Loaders;
