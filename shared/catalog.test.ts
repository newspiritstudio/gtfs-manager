import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG_LOGOS, GTFS_CATALOG } from './catalog';

describe('catàleg de GTFS públics', () => {
  it('té identificadors únics i fonts https', () => {
    const ids = GTFS_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of GTFS_CATALOG) {
      expect(entry.homepage).toMatch(/^https:\/\//);
      if (entry.source.kind === 'zip') expect(entry.source.url).toMatch(/^https:\/\//);
      expect(entry.country).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('cada isotip existeix a public/ i cita la fitxa de Wikimedia Commons', () => {
    for (const logo of Object.values(CATALOG_LOGOS)) {
      expect(existsSync(join(process.cwd(), 'public', logo.src))).toBe(true);
      expect(logo.url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  });
});
