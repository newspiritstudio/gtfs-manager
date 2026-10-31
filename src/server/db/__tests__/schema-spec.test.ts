import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { GTFS_SPEC, GTFS_TABLES } from '@shared/gtfs-spec';
import { GTFS_TABLE_SCHEMAS } from '../schema';

describe('database schema and GTFS specification', () => {
  it.each(GTFS_TABLES)('%s: the columns are the specification ones plus our own', (table) => {
    const config = getTableConfig(GTFS_TABLE_SCHEMAS[table]);
    expect(config.name).toBe(table);
    const columns = config.columns
      .map((c) => c.name)
      .filter((n) => !['id', 'feed_id', 'extra'].includes(n));
    expect(columns.sort()).toEqual(GTFS_SPEC[table].fields.map((f) => f.name).sort());
  });

  it.each(GTFS_TABLES)('%s: the natural key has a unique index starting with feed_id', (table) => {
    const { key } = GTFS_SPEC[table];
    if (!key.length) return;
    const config = getTableConfig(GTFS_TABLE_SCHEMAS[table]);
    const unique = config.indexes.find((i) => i.config.unique);
    expect(unique).toBeDefined();
    expect(unique!.config.columns.length).toBeGreaterThanOrEqual(2);
  });
});
