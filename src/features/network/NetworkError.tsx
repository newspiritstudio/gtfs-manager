'use client';

import { CircleAlert, RotateCcw } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

/** Error en carregar la xarxa: missatge i botó per tornar-ho a provar. */
export default function NetworkError({
  onRetry,
  className,
}: {
  onRetry: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className={cn(
        'flex h-full flex-col items-center justify-center gap-3 bg-surface-container-highest p-6 text-center',
        className
      )}
    >
      <CircleAlert className="size-8 text-critical" />
      <p className="text-body-medium text-on-surface-variant">{t('errors.generic')}</p>
      <Button variant="tonal" size="sm" onClick={onRetry}>
        <RotateCcw />
        {t('common.retry')}
      </Button>
    </div>
  );
}
