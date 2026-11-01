/**
 * Imports a GTFS folder (or ZIP) from the command line into a local SQLite file, with the same
 * engine code as the import from the browser:
 *
 *   npm run gtfs:import -- /path/to/folder --name "FGC" --catalog fgc [--db tmp/gtfs.sqlite3]
 *
 * The database defaults to `tmp/gtfs.sqlite3` (created, with its schema, if missing). The next
 * step for the home page animation is `npm run landing:network`, which reads that same file
 * for the feeds imported with a `--catalog` id.
 */
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { getSql, setDriver } from '../src/engine/db/client';
import { nodeDriver } from '../src/engine/db/node-driver';
import { appendImportReport, createFeed, finishImport } from '../src/engine/gtfs/feeds';
import { importGtfsFile } from '../src/engine/gtfs/import';
import { ensureStats } from '../src/engine/gtfs/stats';

export const DEFAULT_DB = 'tmp/gtfs.sqlite3';

function option(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const source = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  if (!source) {
    console.error(
      'Usage: npm run gtfs:import -- <folder|file.zip> [--name "Feed name"] [--catalog id] [--db file]'
    );
    process.exit(1);
  }
  const catalogId = option(args, '--catalog');
  const name = option(args, '--name') ?? path.basename(source).replace(/\.zip$/i, '');
  const dbPath = path.resolve(option(args, '--db') ?? DEFAULT_DB);
  await mkdir(path.dirname(dbPath), { recursive: true });
  setDriver(nodeDriver(dbPath));
  console.log(`Database ${dbPath}`);

  const feedId = await createFeed({ name, origin: 'import', catalogId });
  console.log(`Feed ${name} (${feedId})`);

  const log = (file: string, report: Awaited<ReturnType<typeof importGtfsFile>>) =>
    console.log(`  ${file}: ${report.inserted}/${report.rows} rows (${report.durationMs} ms)`);

  const info = await stat(source);
  if (info.isDirectory()) {
    const files = (await readdir(source)).filter((f) => /\.(txt|geojson)$/i.test(f)).sort();
    for (const file of files) {
      const report = await importGtfsFile(feedId, file, createReadStream(path.join(source, file)));
      await appendImportReport(feedId, report);
      log(file, report);
    }
  } else {
    const zip = await JSZip.loadAsync(await readFile(source));
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !/\.(txt|geojson)$/i.test(entry.name)) continue;
      // A web stream over the entry's bytes: the same kind of source as the browser's.
      const bytes = await entry.async('uint8array');
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      const report = await importGtfsFile(feedId, entry.name, stream);
      await appendImportReport(feedId, report);
      log(entry.name, report);
    }
  }
  await finishImport(feedId);
  const started = Date.now();
  const stats = await ensureStats(feedId);
  console.log(
    `Stats in ${Date.now() - started} ms: ${stats?.validation.errors ?? 0} errors, ${
      stats?.validation.warnings ?? 0
    } warnings`
  );
  void getSql();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
