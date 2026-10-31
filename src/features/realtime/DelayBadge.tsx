import { Ban, Radio } from 'lucide-react';
import type { RealtimeTripUpdate } from '@shared/realtime';
import Badge from '@/components/ui/Badge';
import { useI18n } from '@/lib/i18n/client';
import { delayTone, formatDelay, stopDelay } from './delay';

/**
 * The live state of a trip at a stop: cancelled, not stopping there, or its delay. Nothing when
 * the realtime data says nothing about that stop.
 */
export default function DelayBadge({
  update,
  stopIds,
}: {
  update: RealtimeTripUpdate;
  /** The stop and, for a station, its platforms. */
  stopIds: string[];
}) {
  const { t } = useI18n();
  if (update.relationship === 'CANCELED' || update.relationship === 'DELETED') {
    return (
      <Badge tone="critical" icon={<Ban />}>
        {t('realtime.relationship.CANCELED')}
      </Badge>
    );
  }
  const stop = update.stops.find((s) => s.stopId && stopIds.includes(s.stopId));
  if (stop?.skipped) {
    return (
      <Badge tone="critical" icon={<Ban />}>
        {t('realtime.skipped')}
      </Badge>
    );
  }
  const delay = (stop && stopDelay(stop)) ?? update.delay;
  if (delay === null) return null;
  return (
    <Badge tone={delayTone(delay)} icon={<Radio />}>
      {formatDelay(delay) ?? t('realtime.onTime')}
    </Badge>
  );
}
