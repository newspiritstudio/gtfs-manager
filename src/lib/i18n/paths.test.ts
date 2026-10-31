import { describe, expect, it } from 'vitest';
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
});
