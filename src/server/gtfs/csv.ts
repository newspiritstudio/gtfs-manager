/**
 * Lector CSV incremental (RFC 4180) per a fitxers GTFS que no caben a la memòria: rep el text a
 * trossos i torna les files acabades. Admet camps entre cometes amb comes, salts de línia i cometes
 * doblades, finals de línia CRLF i la marca BOM. Les línies buides no són files.
 */
export class CsvParser {
  private field = '';
  private row: string[] = [];
  private inQuotes = false;
  /** S'acaba de tancar unes cometes: si en ve una altra, és una cometa escapada (""). */
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
      // Fora de cometes: avança fins al proper caràcter especial.
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
      // \r s'ignora: o bé ve un \n, o és un final de línia antic que no fem servir.
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

/** Recorre les files d'una font de bytes UTF-8. */
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

/** Escriu un camp CSV, amb cometes només si cal. */
export function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
