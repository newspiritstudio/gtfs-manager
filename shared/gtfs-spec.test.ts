import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../src/engine/db/schema';
import { GTFS_SPEC, GTFS_TABLES, TABLE_GROUPS, tableForFile, tablesInGroup } from './gtfs-spec';

describe('GTFS specification model', () => {
  it('covers the 32 files of the reference', () => {
    expect(GTFS_TABLES).toHaveLength(32);
    expect(new Set(GTFS_TABLES.map((t) => GTFS_SPEC[t].file)).size).toBe(32);
  });

  it('has unique field names, and keys that are fields of the table', () => {
    for (const table of GTFS_TABLES) {
      const spec = GTFS_SPEC[table];
      const names = spec.fields.map((f) => f.name);
      expect(new Set(names).size, table).toBe(names.length);
      for (const key of [...spec.key, ...spec.primaryKey]) expect(names, table).toContain(key);
      expect(names, table).toContain(spec.labelField);
    }
  });

  it('points every reference at an existing field', () => {
    for (const table of GTFS_TABLES) {
      for (const field of GTFS_SPEC[table].fields) {
        for (const ref of field.refs ?? []) {
          const target = GTFS_SPEC[ref.table];
          expect(target, `${table}.${field.name}`).toBeDefined();
          expect(
            target.fields.some((f) => f.name === ref.field),
            `${table}.${field.name} -> ${ref.table}.${ref.field}`
          ).toBe(true);
        }
      }
    }
  });

  it('names fields in its rules that exist, and has enum values for enum fields', () => {
    for (const table of GTFS_TABLES) {
      const spec = GTFS_SPEC[table];
      const names = new Set(spec.fields.map((f) => f.name));
      for (const rule of spec.rules ?? [])
        expect(names.has(rule.field), `${table}.${rule.field}`).toBe(true);
      for (const field of spec.fields) {
        if (field.type === 'enum')
          expect(field.enumValues?.length, `${table}.${field.name}`).toBeGreaterThan(0);
        expect((field.since ?? 1) <= SCHEMA_VERSION).toBe(true);
      }
    }
  });

  it('groups every file once and finds files by name', () => {
    const grouped = TABLE_GROUPS.flatMap((g) => tablesInGroup(g));
    expect([...grouped].sort()).toEqual([...GTFS_TABLES].sort());
    expect(tableForFile('locations.geojson')).toBe('locations');
    expect(tableForFile('fare_products.txt')).toBe('fare_products');
    expect(tableForFile('readme.md')).toBeNull();
  });
});
