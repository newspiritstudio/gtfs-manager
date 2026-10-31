/**
 * Incremental CSV reader (RFC 4180) for GTFS files that do not fit in memory: takes the text in
 * chunks and returns the finished rows. Supports quoted fields with commas, line breaks and doubled
 * quotes, CRLF line endings and the BOM. Empty lines are not rows.
 */
export class CsvParser {
  private field = '';
  private row: string[] = [];
  private inQuotes = false;
  /** A quote was just closed: if another follows, it is an escaped quote (""). */
  private afterQuote = false;
  private started = false;

  push(chunk: string): string[][] {
    const out: string[][] = [];
    let text = chunk;
    if (!this.started) {
      this.started = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    const len = text.length;
    let i = 0;
    while (i < len) {
      if (this.inQuotes) {
        const close = text.indexOf('"', i);
        if (close === -1) {
          this.field += text.slice(i);
          break;
        }
        this.field += text.slice(i, close);
        this.inQuotes = false;
        this.afterQuote = true;
        i = close + 1;
        continue;
      }
      // Outside quotes: advance to the next special character.
      let j = i;
      while (j < len) {
        const c = text.charCodeAt(j);
        if (c === 44 /* , */ || c === 10 /* \n */ || c === 13 /* \r */ || c === 34 /* " */) break;
        j++;
      }
      if (j > i) {
        this.field += text.slice(i, j);
        this.afterQuote = false;
      }
      if (j >= len) break;
      const c = text.charCodeAt(j);
      if (c === 34) {
        if (this.afterQuote) {
          this.field += '"';
          this.inQuotes = true;
          this.afterQuote = false;
        } else if (this.field.trim() === '') {
          this.field = '';
          this.inQuotes = true;
        } else {
          this.field += '"';
        }
      } else if (c === 44) {
        this.row.push(this.field);
        this.field = '';
        this.afterQuote = false;
      } else if (c === 10) {
        this.endRow(out);
      }
      // \r is ignored: either a \n follows, or it is a legacy line ending we do not use.
      i = j + 1;
    }
    return out;
  }

  end(): string[][] {
    const out: string[][] = [];
    if (this.field !== '' || this.row.length > 0) this.endRow(out);
    return out;
  }

  private endRow(out: string[][]) {
    this.row.push(this.field);
    this.field = '';
    this.afterQuote = false;
    const row = this.row;
    this.row = [];
    if (row.length === 1 && row[0].trim() === '') return;
    out.push(row);
  }
}

/** Iterates the rows of a UTF-8 byte source. */
export async function* readCsvRows(source: AsyncIterable<Uint8Array | string>) {
  const decoder = new TextDecoder('utf-8');
  const parser = new CsvParser();
  for await (const chunk of source) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    const rows = parser.push(text);
    if (rows.length) yield rows;
  }
  const tail = parser.push(decoder.decode());
  const rest = parser.end();
  if (tail.length || rest.length) yield [...tail, ...rest];
}

/** Writes a CSV field, quoting only when needed. */
export function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
