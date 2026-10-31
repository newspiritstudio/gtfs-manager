import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { DEFAULT_LOCALE } from '@/lib/i18n/config';
import { PREFIXED_LOCALES } from '@/lib/i18n/paths';
import AppShell from '@/components/shell/AppShell';
import MotionProvider from '@/components/shell/MotionProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { useEngine, useEngineStorage } from '@/lib/engine';
import { I18nProvider } from '@/lib/i18n/client';
import LandingPage from '@/pages/public/LandingPage';
import DatabaseBusyPage from './DatabaseBusyPage';
import NotFoundPage from './NotFoundPage';
import PageBoundary from './PageBoundary';

/* The public pages ship in the first bundle (they are prerendered); the workspace loads on demand. */
const CatalogPage = lazy(() => import('@/pages/public/CatalogPage'));
const CatalogEntryPage = lazy(() => import('@/pages/public/CatalogEntryPage'));
const FeedsPage = lazy(() => import('@/pages/FeedsPage'));
const NewFeedPage = lazy(() => import('@/pages/NewFeedPage'));
const OverviewPage = lazy(() => import('@/pages/feed/OverviewPage'));
const MapPage = lazy(() => import('@/pages/feed/MapPage'));
const RoutesPage = lazy(() => import('@/pages/feed/RoutesPage'));
const RoutePage = lazy(() => import('@/pages/feed/RoutePage'));
const StopsPage = lazy(() => import('@/pages/feed/StopsPage'));
const StopPage = lazy(() => import('@/pages/feed/StopPage'));
const TripPage = lazy(() => import('@/pages/feed/TripPage'));
const CalendarPage = lazy(() => import('@/pages/feed/CalendarPage'));
const DataPage = lazy(() => import('@/pages/feed/DataPage'));
const TablePage = lazy(() => import('@/pages/feed/TablePage'));
const GeneratorPage = lazy(() => import('@/pages/feed/GeneratorPage'));
const RealtimePage = lazy(() => import('@/pages/feed/RealtimePage'));
const ValidationPage = lazy(() => import('@/pages/feed/ValidationPage'));

function publicRoutes(prefix: string) {
  return [
    <Route key={`${prefix}/`} path={prefix || '/'} element={<LandingPage />} />,
    <Route key={`${prefix}/catalog`} path={`${prefix}/catalog`} element={<CatalogPage />} />,
    <Route
      key={`${prefix}/catalog/:id`}
      path={`${prefix}/catalog/:catalogId`}
      element={<CatalogEntryPage />}
    />,
  ];
}

/** English has no prefix: `/en/catalog` is `/catalog`. */
function WithoutDefaultLocale() {
  const { pathname, search, hash } = useLocation();
  const path = pathname.slice(DEFAULT_LOCALE.length + 1) || '/';
  return <Navigate to={`${path}${search}${hash}`} replace />;
}

function Pages() {
  const { pathname } = useLocation();
  return (
    <PageBoundary resetKey={pathname}>
      <Suspense>
        <Routes>
          {publicRoutes('')}
          {PREFIXED_LOCALES.flatMap((locale) => publicRoutes(`/${locale}`))}
          <Route path={`/${DEFAULT_LOCALE}/*`} element={<WithoutDefaultLocale />} />
          <Route path="/feeds" element={<FeedsPage />} />
          <Route path="/new" element={<NewFeedPage />} />
          <Route path="/feeds/:feedId">
            <Route index element={<OverviewPage />} />
            <Route path="map" element={<MapPage />} />
            <Route path="routes" element={<RoutesPage />} />
            <Route path="routes/:routeId" element={<RoutePage />} />
            <Route path="stops" element={<StopsPage />} />
            <Route path="stops/:stopId" element={<StopPage />} />
            <Route path="trips/:tripId" element={<TripPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="data" element={<DataPage />} />
            <Route path="data/:table" element={<TablePage />} />
            <Route path="generator" element={<GeneratorPage />} />
            <Route path="realtime" element={<RealtimePage />} />
            <Route path="validation" element={<ValidationPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </PageBoundary>
  );
}

/** The workspace: the pages that read the visitor's database. */
const isWorkspace = (pathname: string) => /^\/(feeds|new)(\/|$)/.test(pathname);

function Shell() {
  const { pathname } = useLocation();
  const storage = useEngineStorage();
  // The feed list of the sidebar; public pages render before the engine answers.
  const feeds = useEngine('listFeedNames').data ?? [];
  return (
    <AppShell feeds={feeds}>
      {storage === 'busy' && isWorkspace(pathname) ? <DatabaseBusyPage /> : <Pages />}
    </AppShell>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <MotionProvider>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </MotionProvider>
    </I18nProvider>
  );
}
