import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES } from './config';
import { isPublicPath, localizedPath, splitLocalePath } from './paths';

describe('adreces per idioma', () => {
  it('treu i posa el prefix', () => {
    expect(splitLocalePath('/fr/catalog/fgc')).toEqual({ locale: 'fr', path: '/catalog/fgc' });
    expect(splitLocalePath('/de')).toEqual({ locale: 'de', path: '/' });
    expect(splitLocalePath('/catalog')).toEqual({ locale: null, path: '/catalog' });
    expect(splitLocalePath('/feeds/abc')).toEqual({ locale: null, path: '/feeds/abc' });
    expect(localizedPath('en', '/catalog')).toBe('/catalog');
    expect(localizedPath('ca', '/catalog')).toBe('/ca/catalog');
    expect(splitLocalePath('/ca')).toEqual({ locale: 'ca', path: '/' });
    expect(splitLocalePath('/en/catalog')).toEqual({ locale: null, path: '/en/catalog' });
    expect(localizedPath('ja', '/')).toBe('/ja');
    expect(localizedPath('ja', '/catalog/fgc')).toBe('/ja/catalog/fgc');
  });

  it('only home and catalog are public', () => {
    expect(isPublicPath('/')).toBe(true);
    expect(isPublicPath('/catalog/fgc')).toBe(true);
    expect(isPublicPath('/feeds')).toBe(false);
    expect(isPublicPath('/new')).toBe(false);
  });

  it('the proxy knows every language', () => {
    // The proxy `matcher` must be a literal: this checks it has not fallen behind.
    const source = readFileSync(join(process.cwd(), 'proxy.ts'), 'utf8');
    const group = /'\/\(([a-z|]+)\)'/.exec(source)?.[1].split('|').sort();
    expect(group).toEqual([...LOCALES].sort());
  });
});
