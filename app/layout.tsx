import type { Metadata, Viewport } from 'next';
import '../src/index.css';
import '../src/gtfs.css';
import AppShell from '@/components/shell/AppShell';
import MotionProvider from '@/components/shell/MotionProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { I18nProvider } from '@/lib/i18n/client';
import { themeBootstrapScript } from '@/lib/theme';
import { listFeedNames } from '@/server/gtfs/feeds';
import { getI18n, MESSAGES } from '@/server/i18n';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: { default: 'GTFS Manager', template: '%s · GTFS Manager' },
    description: t('app.description'),
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
  const feeds = await listFeedNames();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript() }} />
      </head>
      <body suppressHydrationWarning>
        <I18nProvider locale={locale} messages={messages} fallback={MESSAGES.ca}>
          <MotionProvider>
            <ToastProvider>
              <AppShell feeds={feeds}>{children}</AppShell>
            </ToastProvider>
          </MotionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
