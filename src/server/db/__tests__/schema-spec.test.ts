import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { GTFS_SPEC, GTFS_TABLES } from '@shared/gtfs-spec';
import { GTFS_TABLE_SCHEMAS } from '../schema';

describe('esquema de la base de dades i especificació GTFS', () => {
  it.each(GTFS_TABLES)("%s: les columnes són les de l'especificació més les pròpies", (table) => {
    const config = getTableConfig(GTFS_TABLE_SCHEMAS[table]);
    expect(config.name).toBe(table);
    const columns = config.columns
      .map((c) => c.name)
      .filter((n) => !['id', 'feed_id', 'extra'].includes(n));
    expect(columns.sort()).toEqual(GTFS_SPEC[table].fields.map((f) => f.name).sort());
  });

  it.each(GTFS_TABLES)('%s: la clau natural té un índex únic que comença per feed_id', (table) => {
    const { key } = GTFS_SPEC[table];
    if (!key.length) return;
    const config = getTableConfig(GTFS_TABLE_SCHEMAS[table]);
    const unique = config.indexes.find((i) => i.config.unique);
    expect(unique).toBeDefined();
    expect(unique!.config.columns.length).toBeGreaterThanOrEqual(2);
  });
});
