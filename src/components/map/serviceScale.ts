/**
 * The scale of the frequency map: six bins of trips per hour, one blue hue from light to dark on
 * the light theme and from dark to light on the dark one (more service always reads as more
 * contrast against the map), plus a line weight that grows with the bin so colour is never the
 * only cue.
 */
export const FREQUENCY_BINS = [
  { max: 1, label: '< 1' },
  { max: 2, label: '1–2' },
  { max: 4, label: '2–4' },
  { max: 8, label: '4–8' },
  { max: 15, label: '8–15' },
  { max: Infinity, label: '≥ 15' },
] as const;

export const FREQUENCY_RAMP = {
  light: ['#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
  dark: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'],
};

export const FREQUENCY_WEIGHTS = [2, 3, 4, 5, 6, 7];

export function frequencyBin(perHour: number): number {
  const i = FREQUENCY_BINS.findIndex((b) => perHour < b.max);
  return i < 0 ? FREQUENCY_BINS.length - 1 : i;
}

/** Coverage fill: the same hue, one step per theme. */
export const COVERAGE_COLOR = { light: '#3987e5', dark: '#6da7ec' };
