import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { themeBootstrapScript } from './src/lib/theme.ts';

/** The theme script in the head (no flash of the wrong theme), and the site files. */
function site(siteUrl: string): Plugin {
  return {
    name: 'gtfs-manager-site',
    // As the hosts do: a prerendered page if there is one, otherwise the bare app (`404.html`).
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = new URL(req.url ?? '/', 'http://preview');
        const file = path.join(server.config.build.outDir, url.pathname);
        if (!(existsSync(file) && statSync(file).isFile())) {
          const page = path.join(url.pathname, 'index.html');
          req.url = existsSync(path.join(server.config.build.outDir, page)) ? page : '/404.html';
        }
        next();
      });
    },
    transformIndexHtml: (html) =>
      html.replace('<!--theme-->', `<script>${themeBootstrapScript()}</script>`),
    generateBundle() {
      // Feeds live in each visitor's browser: only the public pages are worth crawling.
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: JSON.stringify(
          {
            name: 'GTFS Manager',
            short_name: 'GTFS',
            start_url: '/feeds',
            display: 'standalone',
            background_color: '#f7f9ff',
            theme_color: '#1f4f86',
            categories: ['productivity', 'utilities', 'travel'],
            icons: [
              { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
              { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
            ],
          },
          null,
          2
        ),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const siteUrl = (env.VITE_SITE_URL || 'https://gtfs.newspirit.studio').replace(/\/$/, '');
  return {
    plugins: [react(), tailwindcss(), site(siteUrl)],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      },
    },
    // SQLite ships its own WebAssembly loader: pre-bundling would break the path to the .wasm.
    optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
    worker: { format: 'es' },
    build: { target: 'es2022', sourcemap: true },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts', 'scripts/**/*.test.ts'],
    },
  };
});
