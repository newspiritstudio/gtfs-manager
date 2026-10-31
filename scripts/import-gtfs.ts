/**
 * Imports a GTFS folder (or ZIP) from the command line:
 *
 *   npm run gtfs:import -- /path/to/folder --name "Renfe Cercanias" [--catalog renfe-cercanias]
 *
 * Uses the same code as the import from the browser.
 */
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { getSql } from '../src/server/db/client';
import { appendImportReport, createFeed, finishImport } from '../src/server/gtfs/feeds';
import { importGtfsFile } from '../src/server/gtfs/import';
import { ensureStats } from '../src/server/gtfs/stats';

async function main() {
  const args = process.argv.slice(2);
  const source = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  const nameIndex = args.indexOf('--name');
  const catalogIndex = args.indexOf('--catalog');
  const catalogId = catalogIndex >= 0 ? args[catalogIndex + 1] : null;
  if (!source) {
    console.error(
      'Usage: npm run gtfs:import -- <folder|file.zip> [--name "Feed name"] [--catalog id]'
    );
    process.exit(1);
  }
  const name = nameIndex >= 0 ? args[nameIndex + 1] : path.basename(source).replace(/\.zip$/i, '');
  const feedId = await createFeed({ name, origin: 'import', catalogId });
  console.log(`Feed ${name} (${feedId})`);

  const info = await stat(source);
  if (info.isDirectory()) {
    const files = (await readdir(source)).filter((f) => f.toLowerCase().endsWith('.txt')).sort();
    for (const file of files) {
      const report = await importGtfsFile(feedId, file, createReadStream(path.join(source, file)));
      await appendImportReport(feedId, report);
      console.log(`  ${file}: ${report.inserted}/${report.rows} rows (${report.durationMs} ms)`);
    }
  } else {
    const zip = await JSZip.loadAsync(await readFile(source));
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !entry.name.toLowerCase().endsWith('.txt')) continue;
      // JSZip's stream is an old one (no async iterator): `wrap` makes it iterable.
      const stream = new Readable().wrap(entry.nodeStream('nodebuffer'));
      const report = await importGtfsFile(feedId, entry.name, stream);
      await appendImportReport(feedId, report);
      console.log(
        `  ${entry.name}: ${report.inserted}/${report.rows} rows (${report.durationMs} ms)`
      );
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
  await getSql().end();
}

main().catch(async (error) => {
  console.error(error);
  await getSql().end({ timeout: 1 });
  process.exit(1);
});
