import { RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n/client';
import { applyUpdate, dismissOfflineReady, usePwaState } from '@/lib/pwa';

/**
 * "New version available — Reload": it stays until the visitor reloads or dismisses it, because
 * switching versions under an open session is never done silently. The first time the app is
 * ready to work offline it says so once.
 */
export default function UpdatePrompt() {
  const { t } = useI18n();
  const toast = useToast();
  const { updateReady, offlineReady } = usePwaState();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!offlineReady) return;
    toast(t('safety.pwa.offlineReady'));
    dismissOfflineReady();
  }, [offlineReady, t, toast]);

  if (!updateReady || dismissed) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--footer-height,0px)+16px)] z-toast flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-lg-inc border border-outline-variant bg-surface-container-highest py-2.5 pl-4 pr-2 text-body-medium text-on-surface"
      >
        <RefreshCw aria-hidden className="size-5 shrink-0 text-primary" />
        <span className="flex-1">{t('safety.pwa.updateAvailable')}</span>
        <Button size="sm" onClick={applyUpdate}>
          {t('safety.pwa.reload')}
        </Button>
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={() => setDismissed(true)}
          className="inline-flex size-8 items-center justify-center rounded-full text-on-surface-variant state-layer"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
