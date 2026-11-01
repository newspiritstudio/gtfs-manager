/**
 * Writes `dist/sw.js` after `vite build` and the prerender: the service worker template
 * (`scripts/pwa/sw.js`) with the files of this build to precache and a version that changes
 * whenever any of them (or the worker itself) does.
 *
 *   npm run build      # vite build, prerender, then this
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIST = path.resolve('dist');

/** Files under `dir`, as site paths; source maps are left out. */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(DIST, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listFiles(rel)));
    else if (!entry.name.endsWith('.map')) out.push(`/${rel}`);
  }
  return out;
}

async function main() {
  const template = await readFile(path.resolve('scripts/pwa/sw.js'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(DIST, 'manifest.webmanifest'), 'utf8')) as {
    icons: { src: string }[];
  };
  const shell = [
    '/',
    '/404.html',
    '/manifest.webmanifest',
    ...manifest.icons.map((icon) => icon.src),
    ...(await listFiles('assets')),
    ...(await listFiles('fonts')),
  ];
  const precache = [...new Set(shell)].sort();

  // The version: the worker, the list, and the HTML of the app shell (its asset names change).
  const hash = createHash('sha256').update(template);
  for (const url of precache) hash.update(url);
  hash.update(await readFile(path.join(DIST, '404.html')));
  const version = hash.digest('hex').slice(0, 12);

  await writeFile(
    path.join(DIST, 'sw.js'),
    template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache))
  );
  console.log(`Service worker ${version}: ${precache.length} files precached`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
