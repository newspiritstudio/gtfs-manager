import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpDown,
  Footprints,
  Layers,
  LogIn,
  LogOut,
  TrendingUp,
  Waypoints,
  Accessibility,
} from 'lucide-react';
import { useMemo } from 'react';
import Badge from '@/components/ui/Badge';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import type { StationNode, StationPathway, StationStructure } from '@/engine/gtfs/stations';
import { Link } from '@/lib/router';
import { formatDuration, formatNumber } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';

const MODE_ICONS: Record<number, React.ReactNode> = {
  1: <Footprints />,
  2: <Layers />,
  3: <ArrowLeftRight />,
  4: <TrendingUp />,
  5: <ArrowUpDown />,
  6: <LogIn />,
  7: <LogOut />,
};

/** Levels, locations and pathways of a station (`levels.txt`, `pathways.txt`). */
export default function StationStructureCard({
  feedId,
  structure,
}: {
  feedId: string;
  structure: StationStructure;
}) {
  const { t, locale } = useI18n();
  const { station, levels, nodes, pathways } = structure;
  const names = useMemo(() => {
    const m = new Map<string, StationNode>();
    for (const n of nodes) m.set(n.stopId, n);
    return m;
  }, [nodes]);
  const nameOf = (id: string) =>
    id === station.stopId ? (station.name ?? id) : (names.get(id)?.name ?? id);
  const groups = useMemo(() => {
    const out = levels.map((l) => ({
      key: l.levelId,
      title: [l.name, l.index !== null ? `${t('fields.level_index')} ${l.index}` : null]
        .filter(Boolean)
        .join(' · '),
      nodes: nodes.filter((n) => n.levelId === l.levelId),
    }));
    const rest = nodes.filter((n) => !n.levelId);
    if (rest.length) out.push({ key: '', title: t('spec.station.noLevel'), nodes: rest });
    return out.filter((g) => g.nodes.length);
  }, [levels, nodes, t]);

  return (
    <Card>
      <CardHeader
        title={t('spec.station.title')}
        subtitle={t('spec.station.summary', {
          nodes: nodes.length,
          pathways: pathways.length,
          levels: levels.length,
        })}
        icon={<Waypoints />}
      />
      <CardContent className="grid items-start gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.title || g.key}>
              <h3 className="mb-1.5 text-title-small text-on-surface">{g.title || g.key}</h3>
              <ul className="flex flex-wrap gap-2">
                {g.nodes.map((n) => (
                  <li key={n.stopId} className="max-w-full">
                    <Link
                      href={`/feeds/${feedId}/stops/${encodeURIComponent(n.stopId)}`}
                      className="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-surface-container-highest px-3 py-2 text-body-medium text-on-surface hover:text-primary focus-ring"
                    >
                      <span className="min-w-0 break-words">{n.name ?? n.stopId}</span>
                      <Badge tone="neutral">{t(`enums.location_type.${n.locationType}`)}</Badge>
                      {n.wheelchairBoarding === 1 ? (
                        <Badge tone="success" icon={<Accessibility />}>
                          {t('stops.accessible')}
                        </Badge>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        {pathways.length ? (
          <section aria-label={t('spec.station.pathways')} className="min-w-0">
            <h3 className="mb-1.5 text-title-small text-on-surface">
              {t('spec.station.pathways')}
            </h3>
            <ul className="divide-y divide-outline-variant/60 overflow-hidden rounded-md bg-surface-container-highest">
              {pathways.map((p) => (
                <PathwayRow key={p.pathwayId} p={p} nameOf={nameOf} locale={locale} />
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PathwayRow({
  p,
  nameOf,
  locale,
}: {
  p: StationPathway;
  nameOf: (id: string) => string;
  locale: string;
}) {
  const { t } = useI18n();
  const details = [
    p.length !== null ? `${formatNumber(locale, p.length)} m` : null,
    p.stairCount !== null ? t('spec.station.stairs', { count: Math.abs(p.stairCount) }) : null,
    p.maxSlope !== null ? `${t('fields.max_slope')} ${formatNumber(locale, p.maxSlope)}` : null,
    p.minWidth !== null ? `${t('fields.min_width')} ${formatNumber(locale, p.minWidth)}` : null,
    p.signpostedAs ? `“${p.signpostedAs}”` : null,
  ].filter(Boolean);
  const mode = p.mode ?? 0;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-body-medium">
      <span
        className="flex items-center gap-1.5 text-on-surface-variant [&_svg]:size-4"
        title={t(`enums.pathway_mode.${mode}`)}
      >
        {MODE_ICONS[mode]}
        <span className="text-label-medium">{t(`enums.pathway_mode.${mode}`)}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-on-surface">
        <span>{nameOf(p.fromStopId)}</span>
        {p.bidirectional === 1 ? (
          <ArrowLeftRight
            className="size-4 text-on-surface-variant"
            aria-label={t('enums.is_bidirectional.1')}
          />
        ) : (
          <ArrowRight
            className="size-4 text-on-surface-variant"
            aria-label={t('enums.is_bidirectional.0')}
          />
        )}
        <span>{nameOf(p.toStopId)}</span>
      </span>
      {p.traversalTime !== null ? (
        <Badge tone="primary">
          {p.traversalTime < 120
            ? `${formatNumber(locale, p.traversalTime)} s`
            : formatDuration(locale, p.traversalTime)}
        </Badge>
      ) : null}
      {details.length ? (
        <span className="w-full text-body-small text-on-surface-variant">
          {details.join(' · ')}
        </span>
      ) : null}
    </li>
  );
}
