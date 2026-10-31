'use client';

import { Pause, Play, Shuffle } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef, useState, type RefObject } from 'react';
import IconButton from '@/components/ui/IconButton';
import { formatClock } from '@shared/gtfs-values';
import { useI18n } from '@/lib/i18n/client';
import type { LandingNetwork } from './networks';

/**
 * The home page: a real network picked at random from those in `networks.ts`, with the trains of
 * a weekday running sped up (three minutes per second). The data comes from each operator's GTFS
 * feed (`npm run landing:network`) and is loaded on the client once the network is chosen, so
 * hydration does not mismatch. Trains move by touching SVG attributes, without rendering React
 * every frame; the animation stops off-screen and stays still with "reduced motion".
 */
export interface LandingNetworkInfo {
  id: string;
  name: string;
  operator: string;
  region: string;
  logo?: string;
  href: string;
}

/** Simulation seconds per real second. */
const SPEED = 180;
/** Time the network takes to draw before the trains leave. */
const DRAW_MS = 1400;
const PILL_W = 26;
const PILL_H = 16;
/** Aspect ratio of the drawing: every network fits this box, so nothing jumps on load. */
const BOX: [number, number] = [600, 486];

/**
 * Line names at the ends, pushed away from the city centre. Only short names (S1, A, 10):
 * "Metro A Line" or "Blue-N" do not fit in a pill and the colour already identifies the line.
 */
function placeLabels(network: LandingNetwork) {
  if (network.lines.some((line) => line.name.length > 3)) return [];
  const [cx, cy] = network.center;
  return network.labels.map((label) => {
    const width = label.lines.length * (PILL_W + 2) - 2;
    const len = Math.hypot(label.x - cx, label.y - cy) || 1;
    const x = label.x + ((label.x - cx) / len) * 16 - width / 2;
    const y = label.y + ((label.y - cy) / len) * 16 - PILL_H / 2;
    return {
      lines: label.lines,
      x: Math.min(Math.max(x, 2), network.width - width - 2),
      y: Math.min(Math.max(y, 2), network.height - PILL_H - 2),
    };
  });
}

/** With "reduced motion", the moment shown still: a third of the window (08:00). */
function stillAt(network: LandingNetwork) {
  return network.window[0] + (network.window[1] - network.window[0]) / 3;
}

function pick(networks: LandingNetworkInfo[], except?: string) {
  const pool = networks.filter((n) => n.id !== except);
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function NetworkAnimation({ networks }: { networks: LandingNetworkInfo[] }) {
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<LandingNetworkInfo | null>(null);
  const [network, setNetwork] = useState<LandingNetwork | null>(null);
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();
  const clockRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // Random only on the client: the server cannot know which one will be picked.
    setInfo(pick(networks));
  }, [networks]);

  useEffect(() => {
    if (!info) return;
    const controller = new AbortController();
    fetch(`/landing-networks/${info.id}.json`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: LandingNetwork | null) => setNetwork(data))
      .catch(() => undefined);
    return () => controller.abort();
  }, [info]);

  const ready = info && network?.id === info.id ? network : null;

  return (
    <figure className="rounded-2xl bg-surface-container-low p-4 md:p-6">
      <div className="flex min-h-10 items-center gap-3">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-label-large text-on-surface-variant">
          {info?.logo ? (
            <img src={info.logo} alt="" className="size-5 shrink-0 object-contain" />
          ) : null}
          <span className="min-w-0 truncate">
            <span className="font-medium text-on-surface">{info?.name}</span>
            {info ? ` · ${info.region}` : null}
          </span>
          {ready ? (
            <span
              ref={clockRef}
              className="ml-auto shrink-0 tabular-nums text-on-surface"
              aria-hidden
            >
              {formatClock(reduced ? stillAt(ready) : ready.window[0])}
            </span>
          ) : null}
        </p>
        {ready ? (
          <IconButton
            label={t('landing.network.other')}
            onClick={() => setInfo((current) => pick(networks, current?.id))}
          >
            <Shuffle />
          </IconButton>
        ) : null}
        {ready && !reduced ? (
          <IconButton
            label={paused ? t('landing.network.play') : t('landing.network.pause')}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? <Play /> : <Pause />}
          </IconButton>
        ) : null}
      </div>
      <div className="mt-2" style={{ aspectRatio: `${BOX[0]} / ${BOX[1]}` }}>
        {ready && info ? (
          <NetworkMap
            key={ready.id}
            network={ready}
            name={info.name}
            paused={paused}
            clockRef={clockRef}
          />
        ) : null}
      </div>
      <figcaption className="mt-3 min-h-10 text-body-small text-on-surface-variant">
        {ready && info ? <Caption network={ready} info={info} locale={locale} /> : null}
      </figcaption>
    </figure>
  );
}

function NetworkMap({
  network,
  name,
  paused,
  clockRef,
}: {
  network: LandingNetwork;
  name: string;
  paused: boolean;
  clockRef: RefObject<HTMLSpanElement | null>;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);
  const trainRefs = useRef<(SVGCircleElement | null)[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [start, end] = network.window;
  const simRef = useRef(start);
  const [labels] = useState(() => placeLabels(network));

  useEffect(() => {
    const lengths = pathRefs.current.map((p) => p?.getTotalLength() ?? 0);
    const draw = (time: number) => {
      network.trains.forEach(([line, dep, arr, from, to], i) => {
        const dot = trainRefs.current[i];
        const path = pathRefs.current[line];
        if (!dot || !path) return;
        if (time < dep || time > arr) {
          dot.setAttribute('visibility', 'hidden');
          return;
        }
        const point = path.getPointAtLength(
          (from + ((to - from) * (time - dep)) / (arr - dep)) * lengths[line]
        );
        dot.setAttribute('cx', point.x.toFixed(1));
        dot.setAttribute('cy', point.y.toFixed(1));
        dot.setAttribute('visibility', 'visible');
      });
      if (clockRef.current) clockRef.current.textContent = formatClock(time);
    };

    if (reduced) {
      draw(stillAt(network));
      return;
    }
    if (simRef.current !== start) draw(simRef.current);
    if (paused) return;

    let frame = 0;
    let last = 0;
    let visible = true;
    let ready = simRef.current !== start;
    const tick = (now: number) => {
      if (!ready) {
        // The network is drawn first; trains leave once drawing has finished.
        if (!last) last = now;
        ready = now - last >= DRAW_MS;
        if (!ready) {
          frame = requestAnimationFrame(tick);
          return;
        }
      }
      if (visible && !document.hidden) {
        // A long jump (background tab) does not make the trains run all at once.
        const step = Math.min(now - last, 100) / 1000;
        let next = simRef.current + step * SPEED;
        if (next > end) next = start;
        simRef.current = next;
        draw(next);
      }
      last = now;
      frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    if (svgRef.current) observer.observe(svgRef.current);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [network, paused, reduced, start, end, clockRef]);

  const stroke = (color: string) => (color === '#000000' ? 'currentColor' : color);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${network.width} ${network.height}`}
      className="size-full"
      role="img"
      aria-label={t('landing.network.label', {
        network: name,
        from: formatClock(start),
        to: formatClock(end),
      })}
    >
      <g
        fill="none"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-on-surface"
      >
        {network.lines.map((line, i) => (
          <path
            key={line.name}
            ref={(el) => {
              pathRefs.current[i] = el;
            }}
            d={line.d}
            pathLength={1}
            className="network-line"
            style={{ animationDelay: `${i * 40}ms` }}
            stroke={stroke(line.color)}
            opacity={0.85}
          />
        ))}
      </g>
      <g className="text-surface-container-low" stroke="currentColor" strokeWidth={1.5}>
        {network.trains.map(([line], i) => {
          const color = network.lines[line].color;
          return (
            <circle
              key={i}
              ref={(el) => {
                trainRefs.current[i] = el;
              }}
              r={4.5}
              visibility="hidden"
              fill={color === '#000000' ? 'var(--md-sys-color-on-surface)' : color}
            />
          );
        })}
      </g>
      <g className="network-labels" fontSize={10} fontWeight={600} textAnchor="middle">
        {labels.map((label) =>
          label.lines.map((line, j) => {
            const x = label.x + j * (PILL_W + 2);
            const { color, text, name: lineName } = network.lines[line];
            return (
              <g key={line}>
                <rect x={x} y={label.y} width={PILL_W} height={PILL_H} rx={4} fill={color} />
                <text x={x + PILL_W / 2} y={label.y + PILL_H / 2} dy="0.35em" fill={text}>
                  {lineName}
                </text>
              </g>
            );
          })
        )}
      </g>
    </svg>
  );
}

function Caption({
  network,
  info,
  locale,
}: {
  network: LandingNetwork;
  info: LandingNetworkInfo;
  locale: string;
}) {
  const { t } = useI18n();
  const [start, end] = network.window;
  const day = new Date(
    `${network.date.slice(0, 4)}-${network.date.slice(4, 6)}-${network.date.slice(6)}T12:00:00Z`
  );
  const date = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(day);
  const number = new Intl.NumberFormat(locale);
  return (
    <>
      {t('landing.network.caption', {
        operator: info.operator,
        lines: number.format(network.lines.length),
        trips: number.format(network.trains.length),
        date,
        from: formatClock(start),
        to: formatClock(end),
        minutes: Math.round(SPEED / 60),
      })}{' '}
      <Link
        href={info.href}
        className="text-primary underline underline-offset-2 hover:no-underline"
      >
        {t('landing.network.feed', { network: info.name })}
      </Link>
    </>
  );
}
