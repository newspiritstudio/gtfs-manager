import { HardDrive, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { useEngineStorage } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { requestPersistence, useStorageInfo } from '@/lib/storage';

function size(locale: string, bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value < 10 && unit ? 1 : 0 }).format(value)} ${units[unit]}`;
}

/** What the feeds take in the browser and whether the browser promises to keep them. */
export default function StoragePanel() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const engineStorage = useEngineStorage();
  const { info, refresh } = useStorageInfo();
  const [asking, setAsking] = useState(false);
  if (!info?.supported) return null;
  const fraction = info.usage !== null && info.quota ? Math.min(1, info.usage / info.quota) : null;

  async function ask() {
    setAsking(true);
    const granted = await requestPersistence();
    setAsking(false);
    refresh();
    toast(
      granted ? t('safety.storage.granted') : t('safety.storage.denied'),
      granted ? 'success' : 'error'
    );
  }

  return (
    <Card className="mb-4" aria-label={t('safety.storage.title')}>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-4">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-primary-tint text-primary icon-slot-5"
        >
          <HardDrive />
        </span>
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-title-medium text-on-surface">{t('safety.storage.title')}</h2>
          {info.usage !== null ? (
            <p className="text-body-small text-on-surface-variant">
              {info.quota
                ? t('safety.storage.usage', {
                    used: size(locale, info.usage),
                    quota: size(locale, info.quota),
                  })
                : size(locale, info.usage)}
            </p>
          ) : null}
          {fraction !== null ? (
            <div
              role="progressbar"
              aria-label={t('safety.storage.title')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.max(1, Math.round(fraction * 100))}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-container-highest"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max(1, fraction * 100)}%` }}
              />
            </div>
          ) : null}
          {engineStorage === 'memory' ? (
            <p className="mt-2 text-body-small text-critical">{t('safety.storage.memory')}</p>
          ) : info.persisted ? null : (
            <p className="mt-2 text-body-small text-on-surface-variant">
              {t('safety.storage.notPersistentHint')}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {info.persisted ? (
            <Badge tone="success" icon={<ShieldCheck />}>
              {t('safety.storage.persistent')}
            </Badge>
          ) : (
            <>
              <Badge tone="warning" icon={<ShieldAlert />}>
                {t('safety.storage.notPersistent')}
              </Badge>
              <Button variant="tonal" size="sm" loading={asking} onClick={() => void ask()}>
                {t('safety.storage.protect')}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
