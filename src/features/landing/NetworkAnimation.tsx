'use client';

import { Pause, Play } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import IconButton from '@/components/ui/IconButton';
import { readableTextColor } from '@shared/gtfs-values';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import network from './fgc-network.json';

/**
 * La portada: la xarxa de FGC de l'àrea de Barcelona amb els trens reals d'un dia feiner entre les
 * 7 i les 10, accelerats (cada segon, tres minuts). Les dades surten del feed GTFS de FGC
 * (`npm run landing:network`). Els trens es mouen tocant atributs SVG, sense renderitzar React a
 * cada fotograma; l'animació s'atura fora de pantalla i amb «moviment reduït» es queda a les 8.
 */
type Train = [line: number, dep: number, arr: number, from: number, to: number];

const TRAINS = network.trains as Train[];
const [START, END] = network.window;
/** Segons de simulació per cada segon real. */
const SPEED = 180;
const STILL_AT = 8 * 3600;
/** Temps que triga a dibuixar-se la xarxa abans que surtin els trens. */
const DRAW_MS = 1400;
const PILL_W = 26;
const PILL_H = 16;

/**
 * Els noms de les línies als extrems: només les S i les R, que arriben lluny (les urbanes acaben
 * totes al mateix racó i s'hi amuntegarien). L'etiqueta s'aparta de l'extrem cap a fora.
 */
const LABELS = network.labels
  .map((label) => ({
    ...label,
    lines: label.lines.filter((i) => /^[SR]/.test(network.lines[i].name)),
  }))
  .filter((label) => label.lines.length)
  .map((label) => {
    const width = label.lines.length * (PILL_W + 2) - 2;
    const cx = network.width / 2;
    const cy = network.height * 0.8;
    const len = Math.hypot(label.x - cx, label.y - cy) || 1;
    const x = label.x + ((label.x - cx) / len) * 16 - width / 2;
    const y = label.y + ((label.y - cy) / len) * 16 - PILL_H / 2;
    return {
      lines: label.lines,
      x: Math.min(Math.max(x, 2), network.width - width - 2),
      y: Math.min(Math.max(y, 2), network.height - PILL_H - 2),
    };
  });

function clock(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function NetworkAnimation() {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);
  const trainRefs = useRef<(SVGCircleElement | null)[]>([]);
  const clockRef = useRef<HTMLSpanElement>(null);
  const figureRef = useRef<HTMLElement>(null);
  const simRef = useRef(START);

  useEffect(() => {
    const lengths = pathRefs.current.map((p) => p?.getTotalLength() ?? 0);
    const draw = (time: number) => {
      TRAINS.forEach(([line, dep, arr, from, to], i) => {
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
      if (clockRef.current) clockRef.current.textContent = clock(time);
    };

    if (reduced) {
      draw(STILL_AT);
      return;
    }
    if (simRef.current !== START) draw(simRef.current);
    if (paused) return;

    let frame = 0;
    let last = 0;
    let visible = true;
    let ready = simRef.current !== START;
    const tick = (now: number) => {
      if (!ready) {
        // Primer es dibuixa la xarxa; els trens surten quan s'ha acabat de dibuixar.
        ready = now - (last || now) >= DRAW_MS;
        if (!last) last = now;
        if (!ready) {
          frame = requestAnimationFrame(tick);
          return;
        }
      }
      if (last && visible && !document.hidden) {
        // Un salt llarg (pestanya en segon pla) no fa córrer els trens de cop.
        const step = Math.min(now - last, 100) / 1000;
        let next = simRef.current + step * SPEED;
        if (next > END) next = START;
        simRef.current = next;
        draw(next);
      }
      last = now;
      frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    if (figureRef.current) observer.observe(figureRef.current);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [paused, reduced]);

  return (
    <figure ref={figureRef} className="rounded-2xl bg-surface-container-low p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-label-large text-on-surface-variant">
          FGC ·{' '}
          <span ref={clockRef} className="tabular-nums text-on-surface" aria-hidden>
            {clock(reduced ? STILL_AT : START)}
          </span>
        </p>
        {reduced ? null : (
          <IconButton
            label={paused ? t('landing.network.play') : t('landing.network.pause')}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? <Play /> : <Pause />}
          </IconButton>
        )}
      </div>
      <svg
        viewBox={`0 0 ${network.width} ${network.height}`}
        className="mt-2 h-auto w-full"
        role="img"
        aria-label={t('landing.network.label')}
      >
        <g fill="none" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
          {network.lines.map((line, i) => (
            <path
              key={line.name}
              ref={(el) => {
                pathRefs.current[i] = el;
              }}
              d={line.d}
              pathLength={1}
              className={cn('network-line', line.color === '#000000' && 'text-on-surface')}
              style={{ animationDelay: `${i * 40}ms` }}
              stroke={line.color === '#000000' ? 'currentColor' : line.color}
              opacity={0.85}
            />
          ))}
        </g>
        <g className="text-surface-container-low" stroke="currentColor" strokeWidth={1.5}>
          {TRAINS.map(([line], i) => {
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
          {LABELS.map((label) =>
            label.lines.map((line, j) => {
              const x = label.x + j * (PILL_W + 2);
              const color = network.lines[line].color;
              return (
                <g key={line}>
                  <rect x={x} y={label.y} width={PILL_W} height={PILL_H} rx={4} fill={color} />
                  <text
                    x={x + PILL_W / 2}
                    y={label.y + PILL_H / 2}
                    dy="0.35em"
                    fill={`#${readableTextColor(color.slice(1))}`}
                  >
                    {network.lines[line].name}
                  </text>
                </g>
              );
            })
          )}
        </g>
      </svg>
      <figcaption className="mt-3 text-body-small text-on-surface-variant">
        {t('landing.network.caption')}
      </figcaption>
    </figure>
  );
}
