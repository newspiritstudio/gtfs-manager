/** El dia que es mostra per defecte: avui si té servei, si no el de més viatges a partir d'avui, si no el de més viatges. */
export function defaultServiceDate(dates: { date: string; trips: number }[]): string | null {
  // El dia local de qui mira la pantalla: amb toISOString() (UTC) passada la mitjanit seria ahir.
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
