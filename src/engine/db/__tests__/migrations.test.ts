import { describe, expect, it } from 'vitest';
import { migrate } from '../migrations';
import { nodeDriver } from '../node-driver';
import { versionStatements } from '../schema';

const names = (driver: ReturnType<typeof nodeDriver>, type: string) =>
  (driver.query(`SELECT name FROM sqlite_master WHERE type = '${type}'`, []) as { name: string }[])
    .map((r) => r.name)
    .sort();

describe('schema migrations', () => {
  it('upgrades a version 1 database in place, keeping its feeds', () => {
    const driver = nodeDriver();
    migrate(driver, 1);
    expect(names(driver, 'table')).not.toContain('fare_products');
    driver.query(`INSERT INTO feeds (id, name) VALUES ('f1', 'Old feed')`, []);
    driver.query(
      `INSERT INTO agency (feed_id, agency_id, agency_name) VALUES ('f1', 'A', 'Agency')`,
      []
    );
    driver.query(
      `INSERT INTO stops (feed_id, stop_id, stop_name, extra) VALUES ('f1', 'S1', 'One', '{"x":"1"}')`,
      []
    );
    driver.query(
      `INSERT INTO stop_times (feed_id, trip_id, stop_id, stop_sequence, arrival_time) VALUES ('f1', 'T', 'S1', 1, 3600)`,
      []
    );
    // Version 1 refuses a stop time without a stop.
    expect(() =>
      driver.query(
        `INSERT INTO stop_times (feed_id, trip_id, stop_id, stop_sequence) VALUES ('f1', 'T', NULL, 2)`,
        []
      )
    ).toThrow();

    migrate(driver);

    const [{ user_version: version }] = driver.query('PRAGMA user_version', []) as {
      user_version: number;
    }[];
    expect(version).toBe(2);
    expect(names(driver, 'table')).toEqual(
      expect.arrayContaining([
        'fare_products',
        'fare_leg_rules',
        'pathways',
        'levels',
        'locations',
        'translations',
      ])
    );
    expect(names(driver, 'index')).toEqual(
      expect.arrayContaining(['pathways_from', 'stops_level'])
    );
    // Old rows survive, with the new columns empty.
    expect(driver.query(`SELECT stop_name, extra FROM stops WHERE stop_id = 'S1'`, [])).toEqual([
      { stop_name: 'One', extra: '{"x":"1"}' },
    ]);
    expect(driver.query(`SELECT cemv_support FROM agency`, [])).toEqual([{ cemv_support: null }]);
    expect(driver.query(`SELECT count(*) AS n FROM stop_times WHERE stop_id = 'S1'`, [])).toEqual([
      { n: 1 },
    ]);
    // Version 2 takes a stop time that points at a flex location.
    driver.query(
      `INSERT INTO stop_times (feed_id, trip_id, stop_id, location_id, stop_sequence) VALUES ('f1', 'T', NULL, 'Z', 2)`,
      []
    );
    // The feed's cascade and its indexes still work.
    driver.query(`DELETE FROM feeds WHERE id = 'f1'`, []);
    expect(driver.query(`SELECT count(*) AS n FROM stop_times`, [])).toEqual([{ n: 0 }]);
  });

  it('is idempotent, and a new database equals an upgraded one', () => {
    const fresh = nodeDriver();
    migrate(fresh);
    migrate(fresh);
    const upgraded = nodeDriver();
    migrate(upgraded, 1);
    migrate(upgraded);
    const columns = (d: ReturnType<typeof nodeDriver>) =>
      (names(d, 'table') as string[])
        .filter((t) => !t.startsWith('sqlite_'))
        .map((t) => [
          t,
          (d.query(`PRAGMA table_info(${t})`, []) as { name: string }[]).map((c) => c.name).sort(),
        ]);
    expect(columns(upgraded)).toEqual(columns(fresh));
  });

  it('has a statement list for every version', () => {
    expect(versionStatements(1).length).toBeGreaterThan(0);
    expect(versionStatements(2).length).toBeGreaterThan(0);
  });
});
