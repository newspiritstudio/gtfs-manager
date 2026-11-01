import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSql } from '../db/client';
import { openTestDb, SAMPLE_FEED } from '../testing';
import { exportFeedZip } from './export';
import { getFares, feedHasFares } from './fares';
import { importGtfsFile } from './import';
import { getNetwork } from './network';
import { getStationStructure } from './stations';
import { createRow, RowValidationError } from './tables';
import { validateFeed } from './validate';

const bytes = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });

const GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'zone-a',
      properties: { stop_name: 'Zone A', stop_desc: 'Flex', colour: 'red' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [2.1, 41.3],
            [2.2, 41.3],
            [2.2, 41.4],
            [2.1, 41.3],
          ],
        ],
      },
    },
  ],
});

const FILES: Record<string, string> = {
  'fare_products.txt':
    'fare_product_id,fare_product_name,fare_media_id,amount,currency,extra_col\nP1,Single,M1,2.50,EUR,keep\nP1,Single reduced,,1.25,EUR,\n',
  'fare_media.txt': 'fare_media_id,fare_media_type\nM1,2\n',
  'areas.txt': 'area_id,area_name\nZ1,Zone 1\nZ2,Zone 2\n',
  'networks.txt': 'network_id,network_name\nN1,Metro\n',
  'fare_leg_rules.txt':
    'leg_group_id,network_id,from_area_id,to_area_id,fare_product_id\nG1,N1,Z1,Z2,P1\n',
  'fare_transfer_rules.txt':
    'from_leg_group_id,to_leg_group_id,transfer_count,duration_limit,duration_limit_type,fare_transfer_type,fare_product_id\nG1,G1,1,3600,1,0,P1\n',
  'levels.txt': 'level_id,level_index,level_name\nL0,0,Street\nL-1,-1,Platforms\n',
  'pathways.txt':
    'pathway_id,from_stop_id,to_stop_id,pathway_mode,is_bidirectional,traversal_time,stair_count\nW1,S1,S1a,2,1,40,-20\n',
  'booking_rules.txt': 'booking_rule_id,booking_type,message\nB1,0,Call us\n',
  'translations.txt':
    'table_name,field_name,language,translation,record_id\nstops,stop_name,ca,Central (CA),S1\n',
  'attributions.txt': 'attribution_id,organization_name,is_producer\nAT1,Maker,1\n',
  'locations.geojson': GEOJSON,
  'notes.md': 'unknown file',
};

async function importAll() {
  for (const [name, text] of Object.entries(FILES))
    await importGtfsFile(SAMPLE_FEED, name, bytes(text));
}

beforeEach(async () => {
  await openTestDb();
});

describe('specification files: import and export', () => {
  it('round-trips the fares, station, flex and translation files', async () => {
    await importAll();
    const zip = await JSZip.loadAsync(await (await exportFeedZip(SAMPLE_FEED)).arrayBuffer());
    for (const name of Object.keys(FILES)) expect(zip.file(name), name).not.toBeNull();
    // Decimals keep their text, unknown columns survive.
    const products = (await zip.file('fare_products.txt')!.async('string')).split('\n');
    expect(products[0]).toBe(
      'fare_product_id,fare_product_name,fare_media_id,amount,currency,extra_col'
    );
    expect(products).toContain('P1,Single,M1,2.50,EUR,keep');
    expect(products).toContain('P1,Single reduced,,1.25,EUR,');
    expect(await zip.file('pathways.txt')!.async('string')).toContain('W1,S1,S1a,2,1');
    expect(await zip.file('notes.md')!.async('string')).toBe('unknown file');
    // Only files with rows are written.
    expect(zip.file('fare_rules.txt')).toBeNull();
    expect(zip.file('timeframes.txt')).toBeNull();
  });

  it('keeps locations.geojson as GeoJSON, with its properties', async () => {
    await importAll();
    const zip = await JSZip.loadAsync(await (await exportFeedZip(SAMPLE_FEED)).arrayBuffer());
    const out = JSON.parse(await zip.file('locations.geojson')!.async('string'));
    expect(out.type).toBe('FeatureCollection');
    expect(out.features).toHaveLength(1);
    expect(out.features[0]).toMatchObject({
      id: 'zone-a',
      properties: { stop_name: 'Zone A', stop_desc: 'Flex', colour: 'red' },
      geometry: { type: 'Polygon' },
    });
    expect(out.features[0].geometry.coordinates).toEqual(
      JSON.parse(GEOJSON).features[0].geometry.coordinates
    );
  });

  it('re-imports its own export without changes', async () => {
    await importAll();
    const first = await exportFeedZip(SAMPLE_FEED);
    const zip = await JSZip.loadAsync(await first.arrayBuffer());
    await getSql()`DELETE FROM fare_products WHERE feed_id = ${SAMPLE_FEED}`;
    await getSql()`DELETE FROM locations WHERE feed_id = ${SAMPLE_FEED}`;
    for (const name of ['fare_products.txt', 'locations.geojson'])
      await importGtfsFile(SAMPLE_FEED, name, bytes(await zip.file(name)!.async('string')));
    const second = await JSZip.loadAsync(await (await exportFeedZip(SAMPLE_FEED)).arrayBuffer());
    for (const name of ['fare_products.txt', 'locations.geojson'])
      expect(await second.file(name)!.async('string')).toBe(await zip.file(name)!.async('string'));
  });

  it('keeps a GeoJSON that is not a FeatureCollection as an unknown file', async () => {
    const text = JSON.stringify({ type: 'Point', coordinates: [1, 2] });
    await importGtfsFile(SAMPLE_FEED, 'locations.geojson', bytes(text));
    const zip = await JSZip.loadAsync(await (await exportFeedZip(SAMPLE_FEED)).arrayBuffer());
    expect(await zip.file('locations.geojson')!.async('string')).toBe(text);
  });
});

describe('fares, stations and flex zones', () => {
  it('presents fares v2 with names resolved', async () => {
    expect(await feedHasFares(SAMPLE_FEED)).toBe(false);
    await importAll();
    expect(await feedHasFares(SAMPLE_FEED)).toBe(true);
    const fares = await getFares(SAMPLE_FEED);
    expect(fares.products.total).toBe(2);
    expect(fares.legRules.rows[0]).toMatchObject({
      networkName: 'Metro',
      fromAreaName: 'Zone 1',
      toAreaName: 'Zone 2',
      fareProductName: 'Single',
    });
    expect(fares.transferRules.rows[0]).toMatchObject({ durationLimit: 3600, fareTransferType: 0 });
    expect(fares.media.rows[0].type).toBe(2);
  });

  it('describes the structure of a station', async () => {
    await importAll();
    const structure = await getStationStructure(SAMPLE_FEED, 'S1');
    expect(structure?.levels.map((l) => l.levelId)).toEqual([]);
    expect(structure?.nodes.map((n) => n.stopId).sort()).toEqual(['S1a', 'S1b']);
    expect([...(structure?.pathways ?? [])]).toMatchObject([
      { pathwayId: 'W1', mode: 2, bidirectional: 1, traversalTime: 40, stairCount: -20 },
    ]);
    expect(await getStationStructure(SAMPLE_FEED, 'S2')).toBeNull();
  });

  it('lists the levels the nodes are on', async () => {
    await importAll();
    await getSql()`UPDATE stops SET level_id = 'L-1' WHERE stop_id = 'S1a'`;
    const structure = await getStationStructure(SAMPLE_FEED, 'S1');
    expect([...(structure?.levels ?? [])]).toEqual([
      { levelId: 'L-1', index: -1, name: 'Platforms' },
    ]);
  });

  it('puts flex zones on the network map', async () => {
    await importAll();
    const network = await getNetwork(SAMPLE_FEED);
    expect(network?.zones).toHaveLength(1);
    expect(network?.zones?.[0]).toMatchObject({ locationId: 'zone-a', name: 'Zone A' });
    expect(network?.bbox?.[0]).toBeLessThanOrEqual(41.3);
  });
});

describe('specification validation', () => {
  const forFile = async (file: string) =>
    (await validateFeed(SAMPLE_FEED)).filter(
      (i) => i.table && i.code.startsWith('spec') && file.includes(i.table)
    );
  const codesFor = async (table: string) =>
    (await validateFeed(SAMPLE_FEED))
      .filter((i) => i.table === table && i.code.startsWith('spec'))
      .map((i) => `${i.code}:${i.field ?? ''}`);

  it('accepts the sample files', async () => {
    await importAll();
    const spec = (await validateFeed(SAMPLE_FEED)).filter((i) => i.code.startsWith('spec'));
    expect(spec.map((i) => `${i.table}:${i.code}:${i.field}`)).toEqual([]);
    expect(await forFile('x')).toEqual([]);
  });

  it('flags enums, signs, currencies and unknown references', async () => {
    await importGtfsFile(
      SAMPLE_FEED,
      'fare_products.txt',
      bytes('fare_product_id,amount,currency,fare_media_id,rider_category_id\nP1,-1,ZZZ,NOPE,\n')
    );
    await importGtfsFile(
      SAMPLE_FEED,
      'fare_attributes.txt',
      bytes('fare_id,price,currency_type,payment_method,transfers\nF1,-1.5,EUR,0,\n')
    );
    await importGtfsFile(
      SAMPLE_FEED,
      'fare_media.txt',
      bytes('fare_media_id,fare_media_type\nM1,9\n')
    );
    expect(await codesFor('fare_products')).toEqual(
      expect.arrayContaining(['specInvalidCurrency:currency', 'specUnknownReference:fare_media_id'])
    );
    expect(await codesFor('fare_attributes')).toContain('specInvalidSign:price');
    expect(await codesFor('fare_media')).toContain('specInvalidEnum:fare_media_type');
  });

  it('does not flag flex stop times for lacking a stop or a time', async () => {
    await importGtfsFile(
      SAMPLE_FEED,
      'stop_times.txt',
      bytes(
        'trip_id,stop_id,stop_sequence,arrival_time,location_id,start_pickup_drop_off_window,end_pickup_drop_off_window\nTF,,1,,zone-a,08:00:00,12:00:00\nTF,S2,2,12:30:00,,,\n'
      )
    );
    await importGtfsFile(SAMPLE_FEED, 'locations.geojson', bytes(GEOJSON));
    const codes = (await validateFeed(SAMPLE_FEED)).map((i) => `${i.table}:${i.code}`);
    expect(codes).not.toContain('stop_times:stopTimeUnknownStop');
    expect(codes).not.toContain('stop_times:stopTimeEndpointWithoutTime');
  });

  it('flags conditional requirements and forbidden values', async () => {
    // booking_type 1 needs prior_notice_duration_min; booking_type 0 forbids it.
    await importGtfsFile(
      SAMPLE_FEED,
      'booking_rules.txt',
      bytes('booking_rule_id,booking_type,prior_notice_duration_min\nB1,1,\nB2,0,30\n')
    );
    const codes = await codesFor('booking_rules');
    expect(codes).toContain('specConditionRequired:prior_notice_duration_min');
    expect(codes).toContain('specConditionForbidden:prior_notice_duration_min');
  });

  it('flags a missing levels file when there are elevators, and a bad geometry', async () => {
    await importGtfsFile(
      SAMPLE_FEED,
      'pathways.txt',
      bytes('pathway_id,from_stop_id,to_stop_id,pathway_mode,is_bidirectional\nW1,S1,S1a,5,1\n')
    );
    expect(await codesFor('levels')).toContain('specLevelsRequired:');
    await getSql()`INSERT INTO locations (feed_id, location_id, geometry) VALUES (${SAMPLE_FEED}, 'bad', '{"type":"Point","coordinates":[1,2]}')`;
    expect(await codesFor('locations')).toContain('specInvalidGeometry:geometry');
  });
});

describe('the editor and the specification', () => {
  it('rejects values the specification forbids', async () => {
    await expect(
      createRow(SAMPLE_FEED, 'fare_media', { fare_media_id: 'M1', fare_media_type: '9' })
    ).rejects.toBeInstanceOf(RowValidationError);
    await expect(
      createRow(SAMPLE_FEED, 'fare_products', {
        fare_product_id: 'P',
        amount: 'abc',
        currency: 'EUR',
      })
    ).rejects.toBeInstanceOf(RowValidationError);
    await createRow(SAMPLE_FEED, 'fare_products', {
      fare_product_id: 'P',
      amount: '2.50',
      currency: 'EUR',
    });
    const [row] = await getSql()<
      { amount: string }[]
    >`SELECT amount FROM fare_products WHERE fare_product_id = 'P'`;
    expect(row.amount).toBe('2.50');
  });
});
