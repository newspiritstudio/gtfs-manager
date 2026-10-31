import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/server/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    // Feeds may be crawled but carry `noindex`: if they were blocked here, search engines would
    // not see the tag and could still index the address.
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/editor'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
