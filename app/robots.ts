import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/server/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    // Els feeds es poden rastrejar però porten `noindex`: si es bloquegessin aquí, els cercadors
    // no veurien l'etiqueta i en podrien indexar l'adreça igualment.
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
