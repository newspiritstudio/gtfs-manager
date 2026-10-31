const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

// Recursos estàtics de public/: no porten hash al nom, per això una setmana (i revalidació en
// segon pla) en lloc de «immutable». Els fitxers de /_next/static ja són immutables.
const assetCache = (value) => [{ key: 'Cache-Control', value }];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  images: { unoptimized: true },
  transpilePackages: ['motion'],
  // postgres.js obre sòcols: es queda fora del paquet del servidor.
  serverExternalPackages: ['postgres'],
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/fonts/:file*',
        headers: assetCache('public, max-age=31536000, immutable'),
      },
      {
        source: '/(flags|catalog-logos)/:file*',
        headers: assetCache('public, max-age=604800, stale-while-revalidate=86400'),
      },
    ];
  },
};

export default nextConfig;
