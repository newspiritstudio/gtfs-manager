/** The day shown by default: today if it has service, otherwise the busiest day from today on, otherwise the busiest day. */
export function defaultServiceDate(dates: { date: string; trips: number }[]): string | null {
  // The viewer's local day: with toISOString() (UTC) just after midnight it would be yesterday.
  const now = new Date();
  const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const todayEntry = dates.find((d) => d.date === today);
  if (todayEntry && todayEntry.trips > 0) return today;
  const pick = (list: { date: string; trips: number }[]) =>
    list.reduce<{ date: string; trips: number } | null>(
      (best, d) => (d.trips > 0 && (!best || d.trips > best.trips) ? d : best),
      null
    );
  return (
    (pick(dates.filter((d) => d.date >= today)) ?? pick(dates))?.date ?? dates[0]?.date ?? null
  );
}
