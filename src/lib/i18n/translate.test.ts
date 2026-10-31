import { describe, expect, it } from 'vitest';
import { createTranslator, keepShortWords } from './translate';

describe('keepShortWords', () => {
  it('glues one-letter words to the next one', () => {
    expect(keepShortWords('Visualitza, edita i valida feeds')).toBe(
      'Visualitza, edita i valida feeds'
    );
    expect(keepShortWords('A punt o no')).toBe('A punt o no');
  });

  it('leaves variables alone', () => {
    const t = createTranslator('ca', { k: 'Feed de {name}' });
    expect(t('k', { name: 'a b' })).toBe('Feed de a b');
  });
});
