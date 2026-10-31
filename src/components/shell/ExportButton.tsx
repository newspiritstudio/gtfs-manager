import { Download } from 'lucide-react';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { downloadFrom } from '@/lib/api';
import { useI18n } from '@/lib/i18n/client';

/** Downloads the feed as a GTFS ZIP, built by the engine in the browser. */
export default function ExportButton({ feedId }: { feedId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="tonal"
      size="sm"
      loading={busy}
      onClick={() => {
        setBusy(true);
        downloadFrom(`/api/feeds/${feedId}/export`)
          .catch(() => toast(t('errors.generic'), 'error'))
          .finally(() => setBusy(false));
      }}
    >
      <Download />
      {t('feed.export')}
    </Button>
  );
}
