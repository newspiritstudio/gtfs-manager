/**
 * Writes the HTML of the public pages after `vite build`, one file per page and language
 * (`dist/fr/catalog/fgc/index.html`), so search engines and link previews get the content, the
 * title and the language alternates without running JavaScript. Also writes `sitemap.xml`, and
 * `404.html`: the bare app, which the host serves for every other address (the workspace).
 *
 *   npm run build      # vite build, then this
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { GTFS_CATALOG } from '@shared/catalog';
import { LOCALE_TAGS, LOCALES } from '../src/lib/i18n/config';
import { localizedPath, splitLocalePath } from '../src/lib/i18n/paths';
import type { HeadInput } from '../src/lib/seo';

const DIST = path.resolve('dist');
const PAGES = ['/', '/catalog', ...GTFS_CATALOG.map((entry) => `/catalog/${entry.id}`)];

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

async function main() {
  const template = await readFile(path.join(DIST, 'index.html'), 'utf8');
  // The bare app, for every address that is not a public page.
  await writeFile(path.join(DIST, '404.html'), template);

  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });
  try {
    const { render } = (await vite.ssrLoadModule('/src/app/prerender.tsx')) as {
      render: (url: string) => Promise<{ html: string; head: HeadInput | null }>;
    };
    const { headTags, SITE_URL, absoluteUrl, languageAlternates } = (await vite.ssrLoadModule(
      '/src/lib/seo.ts'
    )) as typeof import('../src/lib/seo');

    let count = 0;
    for (const page of PAGES) {
      for (const locale of LOCALES) {
        const url = localizedPath(locale, page);
        const { html, head } = await render(url);
        if (!head?.public) throw new Error(`${url}: the page did not set a public head`);
        const out = template
          .replace('<html lang="en">', `<html lang="${LOCALE_TAGS[locale]}">`)
          .replace('<title>GTFS Manager</title>', '')
          .replace('<!--head-->', headTags(head))
          .replace('<!--app-->', html);
        const file = path.join(DIST, url, 'index.html');
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, out);
        count++;
      }
    }

    const urls = PAGES.flatMap((page) =>
      LOCALES.map((locale) => {
        const alternates = Object.entries(languageAlternates(page))
          .map(
            ([lang, href]) =>
              `    <xhtml:link rel="alternate" hreflang="${lang}" href="${escape(absoluteUrl(href))}"/>`
          )
          .join('\n');
        return `  <url>\n    <loc>${escape(absoluteUrl(localizedPath(locale, page)))}</loc>\n${alternates}\n  </url>`;
      })
    );
    await writeFile(
      path.join(DIST, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`
    );
    // Prerendered pages must not depend on where they were rendered.
    if (splitLocalePath('/').locale !== null) throw new Error('unexpected locale prefix on /');
    console.log(`Prerendered ${count} pages for ${SITE_URL}`);
  } finally {
    await vite.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
