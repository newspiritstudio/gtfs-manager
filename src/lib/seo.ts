/**
 * The document head: title, description, canonical address, language alternates and social
 * cards. Pages set it with `useDocumentHead`; the prerender (`scripts/prerender.tsx`) writes the
 * same tags into the HTML of the public pages with `headTags`.
 */
import { useEffect } from 'react';
import { LOCALE_TAGS, LOCALES, OG_LOCALES, type Locale } from './i18n/config';
import { localizedPath } from './i18n/paths';

/** The public URL of the installation, for absolute URLs (canonical, sitemap, Open Graph). */
export const SITE_URL = (import.meta.env.VITE_SITE_URL || 'https://gtfs.newspirit.studio').replace(
  /\/$/,
  ''
);
export const SITE_NAME = 'GTFS Manager';

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path === '/' ? '' : path}` || SITE_URL;
}

/** The versions of a public page in each locale, for `hreflang`. */
export function languageAlternates(path: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of LOCALES) languages[LOCALE_TAGS[locale]] = localizedPath(locale, path);
  // Without a prefix: English for search engines and, for people, the browser language.
  languages['x-default'] = path;
  return languages;
}

export interface HeadInput {
  title: string;
  description?: string;
  /** The title already carries the brand (home page): do not append ' · GTFS Manager'. */
  absoluteTitle?: boolean;
  /** An indexable public page: its path without the language prefix, and the language. */
  public?: { path: string; locale: Locale };
}

export function fullTitle({ title, absoluteTitle }: HeadInput): string {
  return absoluteTitle || title === SITE_NAME ? title : `${title} · ${SITE_NAME}`;
}

type Tag = { tag: 'meta' | 'link'; attributes: Record<string, string> };

/** The tags besides `<title>`: the same list for the page and for the prerender. */
export function headElements(input: HeadInput): Tag[] {
  const tags: Tag[] = [];
  const meta = (attributes: Record<string, string>) => tags.push({ tag: 'meta', attributes });
  if (input.description) meta({ name: 'description', content: input.description });
  if (!input.public) {
    // The workspace (feeds, import) is each visitor's own content: it is not indexed.
    meta({ name: 'robots', content: 'noindex, nofollow' });
    return tags;
  }
  const { path, locale } = input.public;
  const url = absoluteUrl(localizedPath(locale, path));
  const title = fullTitle(input);
  tags.push({ tag: 'link', attributes: { rel: 'canonical', href: url } });
  for (const [lang, href] of Object.entries(languageAlternates(path))) {
    tags.push({
      tag: 'link',
      attributes: { rel: 'alternate', hreflang: lang, href: absoluteUrl(href) },
    });
  }
  const image = absoluteUrl('/opengraph-image.png');
  meta({ property: 'og:type', content: 'website' });
  meta({ property: 'og:site_name', content: SITE_NAME });
  meta({ property: 'og:title', content: title });
  if (input.description) meta({ property: 'og:description', content: input.description });
  meta({ property: 'og:url', content: url });
  meta({ property: 'og:locale', content: OG_LOCALES[locale] });
  meta({ property: 'og:image', content: image });
  meta({ property: 'og:image:width', content: '1200' });
  meta({ property: 'og:image:height', content: '630' });
  meta({ name: 'twitter:card', content: 'summary_large_image' });
  return tags;
}

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The head as HTML, for the prerendered pages. */
export function headTags(input: HeadInput): string {
  const tags = headElements(input).map(
    ({ tag, attributes }) =>
      `<${tag} data-head ${Object.entries(attributes)
        .map(([k, v]) => `${k}="${escape(v)}"`)
        .join(' ')}>`
  );
  return [`<title>${escape(fullTitle(input))}</title>`, ...tags].join('\n    ');
}

/* The prerender reads the head a page asked for while it rendered (effects do not run there). */
let rendered: HeadInput | null = null;

export function takeRenderedHead(): HeadInput | null {
  const head = rendered;
  rendered = null;
  return head;
}

/** Sets the head of the current page (the previous page's tags go). */
export function useDocumentHead(input: HeadInput | null) {
  if (import.meta.env.SSR && input) rendered = input;
  const key = JSON.stringify(input);
  useEffect(() => {
    if (!key || key === 'null') return;
    const head = JSON.parse(key) as HeadInput;
    document.title = fullTitle(head);
    document.head.querySelectorAll('[data-head]').forEach((node) => node.remove());
    for (const { tag, attributes } of headElements(head)) {
      const node = document.createElement(tag);
      node.setAttribute('data-head', '');
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      document.head.appendChild(node);
    }
  }, [key]);
}
