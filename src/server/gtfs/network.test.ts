import { describe, expect, it } from 'vitest';
import { pickEncoding } from './network';

describe('pickEncoding', () => {
  it('picks the best encoding the browser accepts', () => {
    expect(pickEncoding('gzip, deflate, br, zstd')).toBe('br');
    expect(pickEncoding('gzip, deflate')).toBe('gzip');
    expect(pickEncoding('identity')).toBe('identity');
    expect(pickEncoding(null)).toBe('identity');
  });
});
