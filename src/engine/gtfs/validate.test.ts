import { beforeEach, describe, expect, it } from 'vitest';
import { LOCALES } from '@/lib/i18n/config';
import { openTestDb, SAMPLE_FEED } from '../testing';
import { VALIDATION_CODES, validateFeed } from './validate';

const messages = (locale: string) =>
  import(`../../locales/${locale}.json`).then(
    (m: { default: { validation: Record<string, string> } }) => m.default.validation
  );

describe('validation rules', () => {
  it('have unique codes', () => {
    expect(new Set(VALIDATION_CODES).size).toBe(VALIDATION_CODES.length);
  });

  it.each(LOCALES)('have a title in %s', async (locale) => {
    const texts = await messages(locale);
    expect(VALIDATION_CODES.filter((code) => !texts[code])).toEqual([]);
  });
});

describe('validateFeed', () => {
  let sql: Awaited<ReturnType<typeof openTestDb>>;
  beforeEach(async () => {
    sql = await openTestDb();
  });

  const codes = async () => (await validateFeed(SAMPLE_FEED)).map((i) => i.code);

  it('runs every rule on the sample feed; only the missing language is reported', async () => {
    expect(await codes()).toEqual(['feedWithoutLanguage']);
  });

  it('flags a broken feed', async () => {
    await sql`INSERT INTO routes (feed_id, route_id, route_short_name, route_long_name, route_type, route_color, route_text_color)
      VALUES (${SAMPLE_FEED}, 'R9', 'A_1', 'Line A_1 north', 3, 'FFFF00', 'FFFFFF')`;
    await sql`INSERT INTO trips (feed_id, route_id, service_id, trip_id, trip_headsign)
      VALUES (${SAMPLE_FEED}, 'R9', 'NOPE', 'T9', 'To A 1')`;
    await sql`INSERT INTO stop_times (feed_id, trip_id, stop_id, stop_sequence, arrival_time, departure_time)
      VALUES (${SAMPLE_FEED}, 'T9', 'S2', 1, 4000, 4000), (${SAMPLE_FEED}, 'T9', 'S3', 2, 3000, 3000),
             (${SAMPLE_FEED}, 'T9', 'GHOST', 3, 3100, 3100)`;
    await sql`UPDATE stops SET stop_name = 'Market S2!', stop_code = NULL WHERE stop_id = 'S2'`;
    await sql`UPDATE agency SET agency_url = 'not a url', agency_phone = '12'`;
    await sql`UPDATE feeds SET import_report = ${sql.json({
      startedAt: 'x',
      finishedAt: null,
      files: [
        {
          file: 'stops.txt',
          unknownColumns: ['foo', 'signposted_as'],
          missingRequiredColumns: [],
          invalidValues: 2,
          trimmedValues: 0,
        },
      ],
    })} WHERE id = ${SAMPLE_FEED}`;
    await sql`INSERT INTO extra_files (feed_id, file_name, content) VALUES (${SAMPLE_FEED}, 'weird.txt', 'x')`;
    const issues = await validateFeed(SAMPLE_FEED);
    const byCode = new Map(issues.map((i) => [i.code, i]));
    for (const code of [
      'tripUnknownService',
      'stopTimeUnknownStop',
      'stopTimeGoesBackwards',
      'stopNameSpecialCharacters',
      'routeNameSpecialCharacters',
      'routeShortInLong',
      'routeColorContrast',
      'tripHeadsignHasShortName',
      'stopNameHasCode',
      'invalidUrl',
      'invalidPhone',
      'unknownColumn',
      'invalidValues',
      'unknownFile',
    ]) {
      expect(byCode.has(code), code).toBe(true);
    }
    expect(byCode.get('unknownColumn')?.samples).toEqual(['stops.txt: foo']);
    expect(byCode.get('stopTimeGoesBackwards')?.samples).toEqual(['T9 #2']);
    expect(byCode.get('stopNameHasCode')?.samples).toEqual(['S2']);
    expect(byCode.get('tripUnknownService')?.sampleNames).toEqual(['To A 1']);
    expect(byCode.get('tripUnknownService')?.count).toBe(1);
    expect(await codes()).toEqual(issues.map((i) => i.code));
  });
});
