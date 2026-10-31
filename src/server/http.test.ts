import { describe, expect, it } from 'vitest';
import { dateParam, intParam } from './http';

const req = (query: string) => new Request(`http://localhost/api?${query}`);

describe('dateParam', () => {
  it('accepta una data real i rebutja el que no ho és', () => {
    expect(dateParam(req('date=20261031'))).toBe('20261031');
    expect(dateParam(req('date=20261345'))).toBeNull();
    expect(dateParam(req('date=20250230'))).toBeNull();
    expect(dateParam(req('date=abc'))).toBeNull();
    expect(dateParam(req(''))).toBeNull();
  });
});

describe('intParam', () => {
  const opts = { fallback: 1, min: 1, max: 100 };
  it('limita el valor i usa el per defecte si no és un nombre', () => {
    expect(intParam(req('page=5'), 'page', opts)).toBe(5);
    expect(intParam(req('page=1e21'), 'page', opts)).toBe(100);
    expect(intParam(req('page=-3'), 'page', opts)).toBe(1);
    expect(intParam(req('page=2.9'), 'page', opts)).toBe(2);
    expect(intParam(req('page=abc'), 'page', opts)).toBe(1);
    expect(intParam(req(''), 'page', opts)).toBe(1);
  });
});
