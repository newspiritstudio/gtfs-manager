/**
 * Renders a public page to HTML for the prerender (`scripts/prerender.ts`). It waits for the
 * lazy pages, so the HTML has the whole page, and returns the head the page asked for.
 */
import { prerenderToNodeStream } from 'react-dom/static';
import { StaticRouter } from 'react-router';
import { preloadLocale, resolveLocale } from '@/lib/i18n/client';
import { takeRenderedHead, type HeadInput } from '@/lib/seo';
import App from './App';

export async function render(url: string): Promise<{ html: string; head: HeadInput | null }> {
  await preloadLocale(resolveLocale(url));
  const { prelude } = await prerenderToNodeStream(
    <StaticRouter location={url}>
      <App />
    </StaticRouter>
  );
  let html = '';
  for await (const chunk of prelude) html += chunk;
  return { html, head: takeRenderedHead() };
}
