const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

// Static assets in public/: no hash in the name, so cache them for a week (with background
// revalidation) instead of `immutable`. Files under /_next/static are already immutable.
const assetCache = (value) => [{ key: 'Cache-Control', value }];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  images: { unoptimized: true },
  // Images are not optimised, so sharp (a native addon) is never loaded: keep it out of the
  // standalone output, which is built on a Mac and runs on Linux.
  outputFileTracingExcludes: { '*': ['node_modules/sharp/**', 'node_modules/@img/**'] },
  transpilePackages: ['motion'],
  // postgres.js opens sockets: keep it out of the server bundle.
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
