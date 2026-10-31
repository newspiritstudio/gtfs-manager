'use client';

import { useI18n } from '@/lib/i18n/client';
import { MobileHeader, MobileNavigationBar } from './MobileChrome';
import SideNav, { type ShellFeed } from './SideNav';
import TopBar from './TopBar';

/**
 * La closca de l'Àgora: a l'escriptori, la barra lateral i la capçalera són un sol marc
 * (surface-container-low) i el contingut hi seu com un panell arrodonit; només el panell fa scroll.
 */
export default function AppShell({
  feeds,
  children,
}: {
  feeds: ShellFeed[];
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-app overflow-hidden text-on-surface md:bg-surface-container-low">
      <a
        href="#main-content"
        className="sr-only z-modal rounded-full bg-primary px-4 py-2 text-on-primary focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        {t('nav.skipToContent')}
      </a>
      <SideNav feeds={feeds} />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar feeds={feeds} />
        <MobileHeader feeds={feeds} />
        <main
          id="main-content"
          tabIndex={-1}
          className="md3-expressive-canvas relative isolate min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 outline-none md:mb-2 md:mr-2 md:rounded-lg md:px-5 md:py-4"
        >
          {children}
        </main>
        <MobileNavigationBar />
      </div>
    </div>
  );
}
