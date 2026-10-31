import { formatClock } from '@shared/gtfs-values';

/**
 * A GTFS time as a figure: "01:09" and, if it falls on the day after the service day, a small
 * "+1". This way a large figure does not wrap because of the "(+1)".
 */
export function ClockTime({ seconds }: { seconds: number | null | undefined }) {
  if (seconds === null || seconds === undefined) return <>—</>;
  const days = Math.floor(seconds / 86400);
  return (
    <span className="whitespace-nowrap">
      {formatClock(seconds - days * 86400)}
      {days ? (
        <sup className="ml-0.5 text-[0.55em] font-medium text-on-surface-muted">+{days}</sup>
      ) : null}
    </span>
  );
}

export function ClockRange({ first, last }: { first: number; last: number }) {
  return (
    <span className="whitespace-nowrap">
      <ClockTime seconds={first} />–<ClockTime seconds={last} />
    </span>
  );
}
