import { DatabaseZap } from 'lucide-react';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { takeOverDatabase, useEngineStorage } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { useDocumentHead } from '@/lib/seo';

/**
 * Another tab holds the database (only one can open it at a time), or this one gave it up when
 * another asked. "Use here" asks the holder to let go and opens it in this tab.
 */
export default function DatabaseBusyPage() {
  const { t } = useI18n();
  const released = useEngineStorage() === 'released';
  const [state, setState] = useState<'idle' | 'waiting' | 'failed'>('idle');
  const title = t(released ? 'safety.tabs.releasedTitle' : 'safety.tabs.busyTitle');
  useDocumentHead({ title });

  async function takeOver() {
    setState('waiting');
    try {
      await takeOverDatabase();
    } catch {
      setState('failed');
    }
  }

  return (
    <EmptyState
      as="h1"
      icon={<DatabaseZap />}
      title={title}
      description={
        state === 'failed'
          ? t('safety.tabs.failed')
          : state === 'waiting'
            ? t('safety.tabs.waiting')
            : t(released ? 'safety.tabs.releasedHint' : 'safety.tabs.busyHint')
      }
      action={
        <Button loading={state === 'waiting'} onClick={() => void takeOver()}>
          {t('safety.tabs.useHere')}
        </Button>
      }
    />
  );
}
