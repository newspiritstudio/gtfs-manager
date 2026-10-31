import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatGtfsTime,
  parseGtfsDate,
  parseGtfsTime,
  routeColors,
  tidyRouteName,
} from './gtfs-values';

describe('GTFS times', () => {
  it('accepts times past 24 h and returns them unchanged', () => {
    expect(parseGtfsTime('25:07:30')).toBe(90450);
    expect(formatGtfsTime(90450)).toBe('25:07:30');
    expect(parseGtfsTime(' 7:05:00')).toBe(25500);
  });

  it('flags the extra service day in the interface', () => {
    expect(formatClock(90450)).toContain('01:07');
    expect(formatClock(90450)).toContain('+1');
    expect(formatClock(null)).toBe('—');
  });

  it('rejects impossible dates', () => {
    expect(parseGtfsDate('20260230')).toBeNull();
    expect(parseGtfsDate('20261031')).toBe('20261031');
  });
});

describe('route colors', () => {
  it('falls back to a stable color without route_color and picks readable text', () => {
    const a = routeColors('R3', null, null);
    expect(a).toEqual(routeColors('R3', undefined, ''));
    expect(['FFFFFF', '000000']).toContain(a.textColor);
  });

  it('ignores a route_text_color without contrast', () => {
    expect(routeColors('X', 'FFFF00', 'FFFFFF').textColor).toBe('000000');
  });

  it('does not accept medium-contrast text (white on a 3.8:1 background)', () => {
    expect(routeColors('L6', '797FBC', 'FFFFFF').textColor).toBe('000000');
    expect(routeColors('L1', '0A3E8A', 'FFFFFF').textColor).toBe('FFFFFF');
  });
});

describe('tidyRouteName', () => {
  it("strips Renfe's space padding and separates origin and destination", () => {
    expect(tidyRouteName('Vic                                     -Centelles')).toBe(
      'Vic – Centelles'
    );
  });

  it('leaves hyphens in compound names alone', () => {
    expect(tidyRouteName('Granollers-Canovelles')).toBe('Granollers-Canovelles');
    expect(tidyRouteName('   ')).toBeNull();
    expect(tidyRouteName(null)).toBeNull();
  });
});
