import type { Metadata, Viewport } from 'next';
import '../src/index.css';
import '../src/gtfs.css';
import AppShell from '@/components/shell/AppShell';
import MotionProvider from '@/components/shell/MotionProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { EditorProvider } from '@/lib/editor';
import { I18nProvider } from '@/lib/i18n/client';
import { themeBootstrapScript } from '@/lib/theme';
import { isEditor } from '@/server/editor';
import { listFeedNames } from '@/server/gtfs/feeds';
import { clientFallback, getI18n } from '@/server/i18n';
import { SITE_NAME, SITE_URL } from '@/server/seo';
import { LOCALE_TAGS } from '@/lib/i18n/config';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
    description: t('app.description'),
    applicationName: SITE_NAME,
    category: 'technology',
    formatDetection: { telephone: false, address: false, email: false },
    openGraph: { type: 'website', siteName: SITE_NAME },
    twitter: { card: 'summary_large_image' },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f9ff' },
    { media: '(prefers-color-scheme: dark)', color: '#111318' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, messages } = await getI18n();
  const [feeds, editor] = await Promise.all([listFeedNames(), isEditor()]);
  return (
    <html lang={LOCALE_TAGS[locale]} suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/google-sans-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript() }} />
      </head>
      <body suppressHydrationWarning>
        <I18nProvider locale={locale} messages={messages} fallback={clientFallback(locale)}>
          <EditorProvider editor={editor}>
            <MotionProvider>
              <ToastProvider>
                <AppShell feeds={feeds}>{children}</AppShell>
              </ToastProvider>
            </MotionProvider>
          </EditorProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
