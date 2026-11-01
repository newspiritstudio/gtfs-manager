import { describe, expect, it } from 'vitest';
import {
  currencyDigits,
  isMixedCaseViolation,
  isValidCurrency,
  isValidCurrencyAmount,
  isValidEmail,
  isValidLanguage,
  isValidTimezone,
  isValidUrl,
} from '../fields';

describe('value validators', () => {
  it('reads URLs', () => {
    expect(isValidUrl('https://example.com/a?b=1')).toBe(true);
    expect(isValidUrl('example.com')).toBe(false);
    expect(isValidUrl('http://')).toBe(false);
  });
  it('reads email addresses', () => {
    expect(isValidEmail('a@b.example')).toBe(true);
    expect(isValidEmail('a@')).toBe(false);
    expect(isValidEmail('no at sign')).toBe(false);
  });
  it('reads language codes, time zones and currencies', () => {
    expect(isValidLanguage('ca')).toBe(true);
    expect(isValidLanguage('pt-BR')).toBe(true);
    expect(isValidLanguage('not a language')).toBe(false);
    expect(isValidTimezone('Europe/Madrid')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidCurrency('EUR')).toBe(true);
    expect(isValidCurrency('XXXX')).toBe(false);
  });
  it('checks the decimals of an amount against its currency', () => {
    expect(currencyDigits('EUR')).toBe(2);
    expect(currencyDigits('JPY')).toBe(0);
    expect(isValidCurrencyAmount('1.50', 'EUR')).toBe(true);
    expect(isValidCurrencyAmount('1.505', 'EUR')).toBe(false);
    expect(isValidCurrencyAmount('100', 'JPY')).toBe(true);
    expect(isValidCurrencyAmount('100.5', 'JPY')).toBe(false);
  });
  it('flags text in a single case', () => {
    expect(isMixedCaseViolation('CENTRAL STATION')).toBe(true);
    expect(isMixedCaseViolation('central station')).toBe(true);
    expect(isMixedCaseViolation('Central Station')).toBe(false);
  });
});
