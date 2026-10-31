import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatGtfsTime,
  parseGtfsDate,
  parseGtfsTime,
  routeColors,
  tidyRouteName,
} from './gtfs-values';

describe('hores GTFS', () => {
  it('admet hores de més de 24 h i les torna igual', () => {
    expect(parseGtfsTime('25:07:30')).toBe(90450);
    expect(formatGtfsTime(90450)).toBe('25:07:30');
    expect(parseGtfsTime(' 7:05:00')).toBe(25500);
  });

  it('marca el dia de servei de més a la interfície', () => {
    expect(formatClock(90450)).toContain('01:07');
    expect(formatClock(90450)).toContain('+1');
    expect(formatClock(null)).toBe('—');
  });

  it('rebutja dates impossibles', () => {
    expect(parseGtfsDate('20260230')).toBeNull();
    expect(parseGtfsDate('20261031')).toBe('20261031');
  });
});

describe('colors de línia', () => {
  it('cau a un color estable sense route_color i hi posa text llegible', () => {
    const a = routeColors('R3', null, null);
    expect(a).toEqual(routeColors('R3', undefined, ''));
    expect(['FFFFFF', '000000']).toContain(a.textColor);
  });

  it('ignora un route_text_color sense contrast', () => {
    expect(routeColors('X', 'FFFF00', 'FFFFFF').textColor).toBe('000000');
  });
});

describe('tidyRouteName', () => {
  it("treu el farciment d'espais de Renfe i separa origen i destinació", () => {
    expect(tidyRouteName('Vic                                     -Centelles')).toBe(
      'Vic – Centelles'
    );
  });

  it('no toca els guions dels noms compostos', () => {
    expect(tidyRouteName('Granollers-Canovelles')).toBe('Granollers-Canovelles');
    expect(tidyRouteName('   ')).toBeNull();
    expect(tidyRouteName(null)).toBeNull();
  });
});
