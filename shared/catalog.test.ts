import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG_LOGOS, GTFS_CATALOG } from './catalog';

describe('public GTFS catalog', () => {
  it('is sorted alphabetically by name', () => {
    const names = GTFS_CATALOG.map((e) => e.name);
    const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
    expect(names).toEqual([...names].sort(collator.compare));
  });

  it('has unique ids and https sources', () => {
    const ids = GTFS_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of GTFS_CATALOG) {
      expect(entry.homepage).toMatch(/^https:\/\//);
      if (entry.source.kind === 'zip') expect(entry.source.url).toMatch(/^https:\/\//);
      expect(entry.country).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('every logo exists in public/ and cites its Wikimedia Commons page', () => {
    for (const logo of Object.values(CATALOG_LOGOS)) {
      expect(existsSync(join(process.cwd(), 'public', logo.src))).toBe(true);
      expect(logo.url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  });

  it('every country has a flag in public/flags', () => {
    for (const { country } of GTFS_CATALOG) {
      expect(existsSync(join(process.cwd(), 'public/flags', `${country.toLowerCase()}.svg`))).toBe(
        true
      );
    }
  });
});
