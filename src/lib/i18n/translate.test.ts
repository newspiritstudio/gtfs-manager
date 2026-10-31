import { describe, expect, it } from 'vitest';
import { createTranslator, keepShortWords } from './translate';

describe('keepShortWords', () => {
  it('enganxa les paraules d’una lletra a la següent', () => {
    expect(keepShortWords('Visualitza, edita i valida feeds')).toBe(
      'Visualitza, edita i valida feeds'
    );
    expect(keepShortWords('A punt o no')).toBe('A punt o no');
  });

  it('no toca les variables', () => {
    const t = createTranslator('ca', { k: 'Feed de {name}' });
    expect(t('k', { name: 'a b' })).toBe('Feed de a b');
  });
});
