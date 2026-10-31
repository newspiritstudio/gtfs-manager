import { describe, expect, it } from 'vitest';
import {
  pickRealtimeText,
  REALTIME_CHECKS,
  realtimeSourcesSchema,
  serviceDayStart,
} from './realtime';

describe('serviceDayStart', () => {
  it('is local midnight on a regular day', () => {
    // 2026-11-03 00:00 in Madrid (UTC+1) is 2026-11-02 23:00 UTC.
    expect(serviceDayStart('20261103', 'Europe/Madrid')).toBe(Date.UTC(2026, 10, 2, 23) / 1000);
  });

  it('is noon minus 12h on a daylight saving day', () => {
    // On 2026-03-29 Madrid moves to UTC+2: noon is 10:00 UTC, so the day starts at 22:00 UTC.
    expect(serviceDayStart('20260329', 'Europe/Madrid')).toBe(Date.UTC(2026, 2, 28, 22) / 1000);
  });

  it('handles time zones west of UTC', () => {
    expect(serviceDayStart('20261103', 'America/New_York')).toBe(Date.UTC(2026, 10, 3, 5) / 1000);
  });
});

describe('pickRealtimeText', () => {
  const texts = [
    { language: 'es', text: 'Retraso' },
    { language: 'ca-ES', text: 'Retard' },
    { language: null, text: 'Delay' },
  ];

  it('prefers the requested language, ignoring the region', () => {
    expect(pickRealtimeText(texts, 'ca')).toBe('Retard');
  });

  it('falls back to the untagged text', () => {
    expect(pickRealtimeText(texts, 'de')).toBe('Delay');
  });
});

describe('realtimeSourcesSchema', () => {
  it('accepts https sources', () => {
    expect(
      realtimeSourcesSchema.safeParse({
        vehiclePositions: { kind: 'url', url: 'https://example.com/vp.pb' },
      }).success
    ).toBe(true);
  });

  it('rejects plain http', () => {
    expect(
      realtimeSourcesSchema.safeParse({
        tripUpdates: { kind: 'url', url: 'http://example.com/tu.pb' },
      }).success
    ).toBe(false);
  });
});

describe('REALTIME_CHECKS', () => {
  it('reports as errors only what makes Google discard the feed', () => {
    const errors = Object.entries(REALTIME_CHECKS)
      .filter(([, check]) => check.severity === 'error')
      .map(([, check]) => check.google)
      .filter(Boolean)
      .sort();
    expect(errors).toEqual([
      'FEED_TOO_OLD',
      'FETCHER_CONNECTION_ERROR',
      'FETCHER_HTTP_ERROR',
      'FULL_DATASET_REQUIRED',
      'INVALID_TIMESTAMP_RANGE',
      'PROTO_MISSING_FIELDS_ERROR',
      'PROTO_PARSE_ERROR',
      'URL_DNS_ERROR',
    ]);
  });

  it('uses each Google code once', () => {
    const codes = Object.values(REALTIME_CHECKS)
      .map((check) => check.google)
      .filter(Boolean);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
