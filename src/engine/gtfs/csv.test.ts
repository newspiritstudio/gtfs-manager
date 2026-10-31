import { describe, expect, it } from 'vitest';
import { CsvParser, csvField } from './csv';

function parse(chunks: string[]) {
  const p = new CsvParser();
  return [...chunks.flatMap((c) => p.push(c)), ...p.end()];
}

describe('CsvParser', () => {
  it('reads quotes, commas, line breaks and CRLF, and strips the BOM', () => {
    expect(parse(['﻿a,b\r\n"x, y","di ""hola""\nadeu"\r\n'])).toEqual([
      ['a', 'b'],
      ['x, y', 'di "hola"\nadeu'],
    ]);
  });

  it('gives the same result when split into arbitrary chunks', () => {
    const text = 'stop_id,stop_name\n1,"Plaça ""Major"""\n2,Sants\n';
    const whole = parse([text]);
    expect(parse(text.split(''))).toEqual(whole);
    expect(whole).toHaveLength(3);
  });

  it('skips empty lines and escapes fields when writing', () => {
    expect(parse(['a\n\n\nb'])).toEqual([['a'], ['b']]);
    expect(csvField('a,"b"')).toBe('"a,""b"""');
    expect(csvField('simple')).toBe('simple');
  });
});
