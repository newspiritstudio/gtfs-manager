/** A row of values; `padded` lists the positions of the quoted values with spaces around them. */
export type CsvRow = string[] & { padded?: number[] };

/**
 * Incremental CSV reader (RFC 4180) for GTFS files that do not fit in memory: takes the text in
 * chunks and returns the finished rows. Supports quoted fields with commas, line breaks and doubled
 * quotes, CRLF line endings and the BOM. Empty lines are not rows.
 */
export class CsvParser {
  /** The number of characters read so far. */
  position = 0;
  /** A quote was opened and never closed (what a file that ends in the middle of a value shows). */
  get unterminated(): boolean {
    return this.inQuotes;
  }
  /** What the unfinished row holds (for a message about a file that could not be read). */
  get partial(): { columnIndex: number; content: string } {
    return { columnIndex: this.row.length, content: this.field };
  }
  private field = '';
  /** The field was opened with a quote. */
  private quoted = false;
  /** Fields of the row being read that were quoted and have spaces around them. */
  private padded: number[] = [];
  private row: string[] = [];
  private inQuotes = false;
  /** A quote was just closed: if another follows, it is an escaped quote (""). */
  private afterQuote = false;
  private started = false;

  /**
   * `keepEmpty`: a line with nothing in it is a row of one empty value instead of being dropped, so
   * the caller can count it (the importer numbers rows by position in the file).
   */
  constructor(private readonly keepEmpty = false) {}

  push(chunk: string): CsvRow[] {
    const out: CsvRow[] = [];
    this.position += chunk.length;
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
          this.quoted = true;
          this.inQuotes = true;
        } else {
          this.field += '"';
        }
      } else if (c === 44) {
        this.endField();
        this.afterQuote = false;
      } else if (c === 10) {
        this.endRow(out);
      }
      // \r is ignored: either a \n follows, or it is a legacy line ending we do not use.
      i = j + 1;
    }
    return out;
  }

  end(): CsvRow[] {
    const out: CsvRow[] = [];
    if (this.field !== '' || this.row.length > 0) this.endRow(out);
    return out;
  }

  private endField() {
    // Whitespace around a value that was not in quotes is dropped by readers; inside quotes it is
    // part of the value, and a notice.
    if (this.quoted && this.field !== this.field.trim()) this.padded.push(this.row.length);
    this.row.push(this.field);
    this.field = '';
    this.quoted = false;
  }

  private endRow(out: CsvRow[]) {
    this.endField();
    this.afterQuote = false;
    const row: CsvRow = this.row;
    const padded = this.padded;
    this.row = [];
    this.padded = [];
    if (row.length === 1 && row[0] === '') {
      if (this.keepEmpty) out.push(row);
      return;
    }
    if (row.length === 1 && row[0].trim() === '' && !this.keepEmpty) return;
    if (padded.length) row.padded = padded;
    out.push(row);
  }
}

/** What the importer reads: Node/browser async iterables, or a web stream (Safari has no iterator on it). */
export type ByteSource = AsyncIterable<Uint8Array | string> | ReadableStream<Uint8Array | string>;

/** Chunks of a source, using a reader when the stream is not async-iterable. */
export async function* sourceChunks(source: ByteSource): AsyncGenerator<Uint8Array | string> {
  if (Symbol.asyncIterator in source) {
    yield* source as AsyncIterable<Uint8Array | string>;
    return;
  }
  const reader = (source as ReadableStream<Uint8Array | string>).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** What the caller may ask of `readCsvRows`. */
export interface CsvReadOptions {
  /** Empty lines come out as rows of one empty value (see `CsvParser`). */
  keepEmpty?: boolean;
  /** Called when the file ends inside a quoted value. */
  onUnterminated?: (info: { position: number; columnIndex: number; content: string }) => void;
}

/** Iterates the rows of a UTF-8 byte source. */
export async function* readCsvRows(source: ByteSource, options: CsvReadOptions = {}) {
  const decoder = new TextDecoder('utf-8');
  const parser = new CsvParser(options.keepEmpty);
  for await (const chunk of sourceChunks(source)) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    const rows = parser.push(text);
    if (rows.length) yield rows;
  }
  const tail = parser.push(decoder.decode());
  if (parser.unterminated) {
    options.onUnterminated?.({
      position: parser.position,
      columnIndex: parser.partial.columnIndex,
      content: parser.partial.content,
    });
  }
  const rest = parser.end();
  if (tail.length || rest.length) yield [...tail, ...rest];
}

/** Writes a CSV field, quoting only when needed. */
export function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
