import { ArrowLeft, MapPinPlus, Move, Route as RouteIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PatternInfo, RoutePatterns } from '@shared/editing';
import { polylineLength } from '@shared/shape-geometry';
import { EditMap } from '@/components/map';
import type { EditMode, LatLon } from '@/components/map/EditMap';
import Button, { ButtonLink } from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import Modal from '@/components/ui/Modal';
import RouteBadge from '@/components/ui/RouteBadge';
import Select from '@/components/ui/Select';
import Skeleton from '@/components/ui/Skeleton';
import Tabs, { SegmentedControl, tabPanelProps } from '@/components/ui/Tabs';
import TextField from '@/components/ui/TextField';
import TimeField from '@/components/ui/TimeField';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api';
import { formatDistance } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import { refreshData, useRefreshKey, useRouter } from '@/lib/router';
import { parseTimeInput, type PatternStopInfo } from '@shared/editing';
import DeleteDialog from './DeleteDialog';
import { editorApi, type StopHit } from './editorApi';
import NewStopDialog from './NewStopDialog';
import PatternList from './PatternList';
import PatternStopsEditor from './PatternStopsEditor';
import { draftFrom, estimateTravel, newUid, sameDraft, type DraftStop } from './stopDraft';
import TimetablePanel from './TimetablePanel';

export interface EditRoute {
  routeId: string;
  shortName: string;
  longName: string;
  color: string;
  textColor: string;
}

type Tab = 'stops' | 'timetable';
interface Meta {
  headsign: string;
  direction: '' | '0' | '1';
  service: string;
  first: string;
  retime: boolean;
}

const metaOf = (p: PatternInfo | undefined, services: string[]): Meta => ({
  headsign: p?.headsign ?? '',
  direction: p?.directionId === 0 ? '0' : p?.directionId === 1 ? '1' : '',
  service: p?.serviceIds[0] ?? services[0] ?? '',
  first: '06:00',
  retime: false,
});

const directionOf = (d: Meta['direction']): 0 | 1 | null => (d === '' ? null : d === '0' ? 0 : 1);

/** Line editing: patterns, stop sequence, timetable grid and the map to move, add and draw. */
export default function RouteEditView({ feedId, route }: { feedId: string; route: EditRoute }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const idBase = useId();
  const refresh = useRefreshKey();
  const [data, setData] = useState<RoutePatterns | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [key, setKey] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('stops');
  const [mode, setMode] = useState<EditMode>('stops');
  const [creating, setCreating] = useState<{ copyFrom: string | null } | null>(null);
  const [draft, setDraft] = useState<DraftStop[]>([]);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta>(metaOf(undefined, []));
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [moved, setMoved] = useState<Record<string, { lat: number; lon: number }>>({});
  const [context, setContext] = useState<StopHit[]>([]);
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  const [newStopAt, setNewStopAt] = useState<{ lat: number; lon: number } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [switchTo, setSwitchTo] = useState<string | 'new' | null>(null);
  const [saved, setSaved] = useState<{ shapeId: string; points: LatLon[]; trips: number } | null>(
    null
  );
  const [shape, setShape] = useState<LatLon[] | null>(null);
  const [shapeId, setShapeId] = useState('');
  const baseSig = useRef('');
  const baseRef = useRef<{ stops: PatternStopInfo[]; headsign: string; direction: string } | null>(
    null
  );

  useEffect(() => {
    let alive = true;
    setFailed(false);
    editorApi.patterns(feedId, route.routeId).then(
      (value) => {
        if (!alive) return;
        setData(value);
        setMoved({});
      },
      () => alive && setFailed(true)
    );
    return () => {
      alive = false;
    };
  }, [feedId, route.routeId, refresh, attempt]);

  const patterns = useMemo(() => data?.patterns ?? [], [data]);
  const pattern = patterns.find((p) => p.key === key) ?? patterns[0];
  const services = data?.services ?? [];

  const dirty =
    creating !== null
      ? draft.length > 0
      : pattern !== undefined &&
        draftKey === pattern.key &&
        (!sameDraft(draft, pattern.stops) ||
          meta.headsign !== (pattern.headsign ?? '') ||
          directionOf(meta.direction) !== pattern.directionId);

  // The draft follows the selected pattern: it restarts when another one is picked or when the
  // pattern changed underneath (an undo), unless the person has unsaved edits.
  useEffect(() => {
    if (!pattern || creating) return;
    const sig = JSON.stringify([
      pattern.key,
      pattern.headsign,
      pattern.directionId,
      pattern.stops.map((s) => [s.stopId, s.travelSecs, s.dwellSecs]),
    ]);
    if (sig === baseSig.current && draftKey === pattern.key) return;
    const base = baseRef.current;
    const edited =
      draftKey === pattern.key &&
      base !== null &&
      (!sameDraft(draft, base.stops) ||
        meta.headsign !== base.headsign ||
        meta.direction !== base.direction);
    if (edited) return;
    baseSig.current = sig;
    const nextMeta = metaOf(pattern, services);
    baseRef.current = {
      stops: pattern.stops,
      headsign: nextMeta.headsign,
      direction: nextMeta.direction,
    };
    setDraft(draftFrom(pattern.stops));
    setDraftKey(pattern.key);
    setMeta(nextMeta);
    setSelected(null);
    // The draft and meta are read at the moment the pattern changes; they must not retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, creating]);

  // Pick a pattern from the address once the data is there.
  useEffect(() => {
    if (data && key === null) {
      const wanted = new URLSearchParams(location.search).get('pattern');
      setKey(data.patterns.find((p) => p.key === wanted)?.key ?? data.patterns[0]?.key ?? null);
    }
  }, [data, key]);

  const select = useCallback(
    (next: string) => {
      setCreating(null);
      setKey(next);
      setShape(null);
      const params = new URLSearchParams(location.search);
      params.set('pattern', next);
      router.replace(`${location.pathname}?${params}`);
    },
    [router]
  );

  // The saved line of the pattern's shape.
  const shapeRef = pattern?.shapeId ?? null;
  useEffect(() => {
    let alive = true;
    if (!shapeRef) {
      setSaved(null);
      return;
    }
    editorApi.shape(feedId, shapeRef).then((s) => {
      if (alive) setSaved(s ? { shapeId: s.shapeId, points: s.points, trips: s.trips } : null);
    });
    return () => {
      alive = false;
    };
  }, [feedId, shapeRef, refresh]);

  // Stops around the view, to click one into the pattern.
  useEffect(() => {
    if (!bbox || tab !== 'stops') return;
    let alive = true;
    const handle = setTimeout(() => {
      editorApi.searchStops(feedId, { bbox, limit: 400 }).then(
        (hits) => alive && setContext(hits),
        () => {}
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [feedId, bbox, tab, refresh]);

  const coords = useMemo(() => {
    const map = new Map<string, { lat: number | null; lon: number | null }>();
    for (const p of patterns)
      for (const s of p.stops) map.set(s.stopId, { lat: s.lat, lon: s.lon });
    return map;
  }, [patterns]);
  const view = useMemo(
    () =>
      draft.map((d) => {
        const at = moved[d.stopId] ?? coords.get(d.stopId);
        return at ? { ...d, lat: at.lat, lon: at.lon } : d;
      }),
    [draft, moved, coords]
  );
  const inPattern = useMemo(() => new Set(draft.map((d) => d.stopId)), [draft]);
  const contextStops = useMemo(
    () => context.filter((c) => !inPattern.has(c.stopId)),
    [context, inPattern]
  );

  const insertStop = (hit: {
    stopId: string;
    name: string | null;
    lat: number | null;
    lon: number | null;
  }) => {
    const at = selected !== null ? selected + 1 : view.length;
    const prev = view[at - 1];
    const stop: DraftStop = {
      uid: newUid(),
      stopId: hit.stopId,
      name: hit.name,
      lat: hit.lat,
      lon: hit.lon,
      source: null,
      travelSecs: prev ? estimateTravel(prev, hit) : 0,
      dwellSecs: 0,
    };
    const next = [...draft];
    next.splice(at, 0, stop);
    if (at === 0 && next[1]) next[1] = { ...next[1], travelSecs: estimateTravel(stop, next[1]) };
    setDraft(next);
    setSelected(at);
  };

  const fail = (error: unknown) => {
    const code = error instanceof ApiError ? error.code : '';
    const known = ['unknownStop', 'unknownService', 'tripIdTaken', 'shapeIdTaken'];
    toast(known.includes(code) ? t(`editor.errors.${code}`) : t('errors.generic'), 'error');
  };

  async function savePattern() {
    if (!pattern) return;
    setBusy(true);
    try {
      const result = await editorApi.editPattern(feedId, route.routeId, pattern.key, {
        stops: draft.map((d, i) => ({
          stopId: d.stopId,
          source: d.source,
          travelSecs: i === 0 ? 0 : d.travelSecs,
          dwellSecs: i === 0 || i === draft.length - 1 ? 0 : d.dwellSecs,
        })),
        retime: meta.retime,
        directionId: directionOf(meta.direction),
        headsign: meta.headsign.trim() || null,
      });
      baseSig.current = '';
      baseRef.current = null;
      setKey(result.key);
      refreshData();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  async function createPattern() {
    const departure = parseTimeInput(meta.first);
    setBusy(true);
    try {
      const result = await editorApi.createPattern(feedId, route.routeId, {
        stops: draft.map((d, i) => ({
          stopId: d.stopId,
          source: null,
          travelSecs: i === 0 ? 0 : d.travelSecs,
          dwellSecs: i === 0 || i === draft.length - 1 ? 0 : d.dwellSecs,
        })),
        serviceId: meta.service,
        directionId: directionOf(meta.direction),
        headsign: meta.headsign.trim() || null,
        firstDeparture: departure ?? 6 * 3600,
        copyFrom: creating?.copyFrom ?? undefined,
      });
      baseSig.current = '';
      baseRef.current = null;
      setCreating(null);
      setKey(result.key);
      refreshData();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  const discard = () => {
    if (creating) {
      setCreating(null);
      setDraftKey(null);
      return;
    }
    if (!pattern) return;
    baseSig.current = '';
    baseRef.current = null;
    setDraft(draftFrom(pattern.stops));
    setMeta(metaOf(pattern, services));
    setSelected(null);
  };

  const startCreate = (copyFrom: string | null) => {
    const source = copyFrom ? patterns.find((p) => p.key === copyFrom) : undefined;
    setCreating({ copyFrom });
    setTab('stops');
    setDraft(source ? draftFrom(source.stops).map((d) => ({ ...d, source: null })) : []);
    setMeta(metaOf(source, services));
    setSelected(null);
    setShape(null);
  };

  const guard = (target: string | 'new') => {
    if (dirty) setSwitchTo(target);
    else if (target === 'new') startCreate(null);
    else select(target);
  };

  async function moveStop(stopId: string, lat: number, lon: number) {
    setMoved((m) => ({ ...m, [stopId]: { lat, lon } }));
    try {
      await editorApi.moveStop(feedId, stopId, lat, lon);
      refreshData();
    } catch (error) {
      setMoved((m) => {
        const { [stopId]: _gone, ...rest } = m;
        return rest;
      });
      fail(error);
    }
  }

  async function saveShape() {
    if (!pattern || !shape) return;
    setBusy(true);
    try {
      await editorApi.saveShape(feedId, route.routeId, pattern.key, {
        shapeId: shapeId.trim(),
        points: shape,
      });
      setShape(null);
      refreshData();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  const enterMode = (next: EditMode) => setMode(next);

  // In shape mode the draft starts as a copy of the saved line and follows it (an undo, a save)
  // for as long as it has not been edited; an edited draft is left alone.
  const seeded = useRef<LatLon[] | null>(null);
  useEffect(() => {
    if (mode !== 'shape' || creating) return;
    if (shape !== null && shape !== seeded.current) return;
    const points = saved?.points ?? null;
    seeded.current = points;
    setShape(points);
    // A shape other patterns share keeps its id only if this pattern is the one using it.
    const own = saved && saved.trips <= (pattern?.trips ?? 0);
    setShapeId(
      own && saved
        ? saved.shapeId
        : `${saved?.shapeId ?? route.routeId}-${pattern?.directionId ?? 'x'}-${(pattern?.key ?? '').slice(0, 4)}`
    );
  }, [mode, creating, saved, shape, pattern, route.routeId]);

  const straight = () => {
    const points = view
      .filter((s) => s.lat !== null && s.lon !== null)
      .map((s) => [s.lat!, s.lon!] as LatLon);
    if (points.length >= 2) setShape(points);
  };

  const label = route.shortName || route.longName || route.routeId;
  const stopsReady = draft.length >= 2;
  const canSavePattern = dirty && stopsReady && !busy;
  const canCreate =
    stopsReady && Boolean(meta.service) && parseTimeInput(meta.first) !== null && !busy;
  const draftTitle = creating
    ? t('editor.patterns.newTitle')
    : pattern
      ? `${pattern.stops[0]?.name ?? ''} → ${pattern.stops[pattern.stops.length - 1]?.name ?? ''}`
      : '';

  if (failed)
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-body-medium text-on-surface-variant">{t('errors.generic')}</p>
        <Button variant="tonal" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          {t('common.retry')}
        </Button>
      </div>
    );

  const header = (
    <header className="flex flex-wrap items-center gap-4 rounded-lg bg-tonal p-4">
      <RouteBadge name={label} color={route.color} textColor={route.textColor} size="lg" />
      <div className="min-w-0 flex-1 basis-56">
        <h1 className="text-title-large text-on-surface sm:text-headline-small">
          {t('editor.title', { route: route.longName || label })}
        </h1>
        <p className="text-body-small text-on-surface-variant">{t('editor.subtitle')}</p>
      </div>
      <ButtonLink
        href={`/feeds/${feedId}/routes/${encodeURIComponent(route.routeId)}`}
        variant="outline"
      >
        <ArrowLeft />
        {t('editor.back')}
      </ButtonLink>
    </header>
  );

  if (!data)
    return (
      <div className="space-y-4">
        {header}
        <Skeleton className="h-96 w-full" />
      </div>
    );

  return (
    <div className="space-y-4">
      {header}
      {!patterns.length && !creating ? (
        <div className="rounded-lg bg-tonal p-8 text-center">
          <p className="text-body-medium text-on-surface-variant">{t('editor.patterns.none')}</p>
          <Button className="mt-4" onClick={() => startCreate(null)}>
            {t('editor.patterns.new')}
          </Button>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="rounded-lg bg-tonal p-3 max-lg:max-h-72 max-lg:overflow-y-auto lg:max-h-[calc(var(--app-height,100dvh)-180px)] lg:overflow-y-auto">
          <PatternList
            patterns={patterns}
            selectedKey={pattern?.key ?? null}
            creating={creating !== null}
            disabled={busy}
            onSelect={(k) => (k === pattern?.key && !creating ? undefined : guard(k))}
            onNew={() => guard('new')}
            onDuplicate={(k) => {
              if (dirty) setSwitchTo(`copy:${k}`);
              else startCreate(k);
            }}
            onDelete={setDeleting}
          />
        </aside>
        {pattern || creating ? (
          <section className="min-w-0 rounded-lg bg-tonal">
            <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
              <h2 className="min-w-0 flex-1 truncate text-title-medium text-on-surface">
                {draftTitle}
              </h2>
            </div>
            <Tabs
              className="mt-1 px-2"
              idBase={`${idBase}-tabs`}
              label={t('editor.tabsLabel')}
              value={creating ? 'stops' : tab}
              onChange={(v) => (creating ? undefined : setTab(v))}
              tabs={[
                { value: 'stops', label: t('editor.tabs.stops'), icon: <RouteIcon /> },
                ...(creating
                  ? []
                  : [{ value: 'timetable' as const, label: t('editor.tabs.timetable') }]),
              ]}
            />
            <div
              {...tabPanelProps(`${idBase}-tabs`, creating ? 'stops' : tab)}
              className="border-t border-outline-variant/60 p-4"
            >
              {creating || tab === 'stops' ? (
                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField
                        label={t('editor.meta.headsign')}
                        value={meta.headsign}
                        onChange={(e) => setMeta({ ...meta, headsign: e.target.value })}
                      />
                      <Select
                        label={t('editor.meta.direction')}
                        value={meta.direction}
                        onChange={(v) => setMeta({ ...meta, direction: v as Meta['direction'] })}
                        options={[
                          { value: '', label: t('editor.patterns.directionNone') },
                          { value: '0', label: t('editor.patterns.direction0') },
                          { value: '1', label: t('editor.patterns.direction1') },
                        ]}
                      />
                      {creating ? (
                        <>
                          <Select
                            label={t('editor.timetable.service')}
                            value={meta.service}
                            onChange={(v) => setMeta({ ...meta, service: v })}
                            options={services.map((s) => ({ value: s, label: s }))}
                          />
                          {creating.copyFrom ? (
                            <p className="self-center text-body-small text-on-surface-variant">
                              {t('editor.meta.copyHint', {
                                count:
                                  patterns.find((p) => p.key === creating.copyFrom)?.trips ?? 0,
                              })}
                            </p>
                          ) : (
                            <TimeField
                              label={t('editor.meta.firstDeparture')}
                              value={meta.first}
                              onChange={(v) => setMeta({ ...meta, first: v })}
                            />
                          )}
                        </>
                      ) : null}
                    </div>
                    <PatternStopsEditor
                      feedId={feedId}
                      stops={view}
                      onChange={setDraft}
                      selected={selected}
                      onSelect={setSelected}
                      onInsert={insertStop}
                      markNew={!creating}
                    />
                    <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 rounded-md bg-surface-container-high px-3 py-2">
                      {!creating ? (
                        <Checkbox
                          checked={meta.retime}
                          onChange={(v) => setMeta({ ...meta, retime: v })}
                        >
                          {t('editor.meta.retime', { count: pattern?.trips ?? 0 })}
                        </Checkbox>
                      ) : null}
                      <span className="ml-auto flex gap-2">
                        {dirty || creating ? (
                          <Button variant="outline" onClick={discard} disabled={busy}>
                            {t('editor.discard')}
                          </Button>
                        ) : null}
                        {creating ? (
                          <Button onClick={createPattern} disabled={!canCreate} loading={busy}>
                            {t('editor.patterns.create')}
                          </Button>
                        ) : (
                          <Button onClick={savePattern} disabled={!canSavePattern} loading={busy}>
                            {t('common.save')}
                          </Button>
                        )}
                      </span>
                    </div>
                    {!creating && dirty ? (
                      <p className="text-body-small text-on-surface-variant">
                        {t('editor.meta.affects', { count: pattern?.trips ?? 0 })}
                      </p>
                    ) : null}
                  </div>
                  <div className="order-first space-y-3 2xl:order-none">
                    <SegmentedControl
                      label={t('editor.map.mode')}
                      value={mode}
                      onChange={enterMode}
                      options={[
                        { value: 'stops', label: t('editor.map.modeStops'), icon: <Move /> },
                        { value: 'add', label: t('editor.map.modeAdd'), icon: <MapPinPlus /> },
                        { value: 'shape', label: t('editor.map.modeShape'), icon: <RouteIcon /> },
                      ]}
                    />
                    <p className="text-body-small text-on-surface-variant">
                      {t(`editor.map.hint.${mode}`)}
                    </p>
                    <div className="h-[28rem] overflow-hidden rounded-md 2xl:sticky 2xl:top-2 2xl:h-[36rem]">
                      <EditMap
                        stops={view.map((s) => ({
                          id: s.stopId,
                          name: s.name,
                          lat: s.lat,
                          lon: s.lon,
                        }))}
                        context={contextStops.map((c) => ({
                          id: c.stopId,
                          name: c.name,
                          lat: c.lat,
                          lon: c.lon,
                        }))}
                        shape={shape ?? saved?.points ?? null}
                        mode={mode}
                        selectedIndex={selected}
                        color={route.color}
                        label={t('nav.map')}
                        fitKey={creating ? 'new' : (pattern?.key ?? '')}
                        onSelect={setSelected}
                        onMoveStop={moveStop}
                        onPickContext={(id) => {
                          const hit = context.find((c) => c.stopId === id);
                          if (hit) insertStop(hit);
                        }}
                        onMapClick={(lat, lon) => setNewStopAt({ lat, lon })}
                        onShapeChange={setShape}
                        onViewport={setBbox}
                      />
                    </div>
                    {mode === 'shape' && !creating ? (
                      <div className="space-y-3 rounded-md bg-surface-container-low p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="outline" size="sm" onClick={straight}>
                            {t('editor.shape.straight')}
                          </Button>
                          {shape ? (
                            <span className="text-body-small tabular-nums text-on-surface-variant">
                              {t('editor.shape.summary', {
                                points: shape.length,
                                length: formatDistance(locale, polylineLength(shape)),
                              })}
                            </span>
                          ) : (
                            <span className="text-body-small text-on-surface-variant">
                              {t('editor.shape.none')}
                            </span>
                          )}
                        </div>
                        {shape ? (
                          <div className="flex flex-wrap items-start gap-2">
                            <div className="min-w-0 flex-1 basis-48">
                              <TextField
                                label={t('editor.shape.id')}
                                value={shapeId}
                                onChange={(e) => setShapeId(e.target.value)}
                                helper={t('editor.shape.idHint')}
                              />
                            </div>
                            <Button
                              variant="outline"
                              onClick={() => setShape(null)}
                              disabled={busy}
                              className="mt-0.5"
                            >
                              {t('editor.discard')}
                            </Button>
                            <Button
                              onClick={saveShape}
                              loading={busy}
                              disabled={!shapeId.trim() || shape.length < 2 || dirty}
                              className="mt-0.5"
                            >
                              {t('editor.shape.save')}
                            </Button>
                          </div>
                        ) : null}
                        {dirty && shape ? (
                          <p className="text-body-small text-on-surface-variant">
                            {t('editor.shape.saveFirst')}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : pattern ? (
                dirty ? (
                  <p className="py-6 text-center text-on-surface-variant">
                    {t('editor.timetable.saveFirst')}
                  </p>
                ) : (
                  <TimetablePanel
                    feedId={feedId}
                    routeId={route.routeId}
                    patternKey={pattern.key}
                    frequencies={data.frequencies}
                  />
                )
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      <NewStopDialog
        feedId={feedId}
        point={newStopAt}
        after={(selected !== null ? view[selected] : view[view.length - 1])?.stopId}
        onClose={() => setNewStopAt(null)}
        onCreated={(stop, join) => {
          setNewStopAt(null);
          setMode('stops');
          if (join) insertStop(stop);
          refreshData();
        }}
      />
      <DeleteDialog
        feedId={feedId}
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        seeds={deleting ? [{ pattern: { routeId: route.routeId, key: deleting } }] : []}
        title={t('editor.patterns.deleteTitle')}
        onDeleted={() => {
          const gone = deleting;
          setDeleting(null);
          if (gone === pattern?.key) {
            baseSig.current = '';
            baseRef.current = null;
            setKey(patterns.find((p) => p.key !== gone)?.key ?? null);
          }
          refreshData();
        }}
      />
      <Modal
        open={switchTo !== null}
        onClose={() => setSwitchTo(null)}
        title={t('editor.unsaved.title')}
        closeLabel={t('common.close')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setSwitchTo(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const target = switchTo;
                setSwitchTo(null);
                setCreating(null);
                if (target === 'new') startCreate(null);
                else if (target?.startsWith('copy:')) startCreate(target.slice(5));
                else if (target) select(target);
              }}
            >
              {t('editor.unsaved.discard')}
            </Button>
          </>
        }
      >
        <p className="text-body-medium text-on-surface">{t('editor.unsaved.body')}</p>
      </Modal>
    </div>
  );
}
