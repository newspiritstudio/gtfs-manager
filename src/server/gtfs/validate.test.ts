import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/lib/i18n/config';
import { VALIDATION_CODES } from './validate';

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
