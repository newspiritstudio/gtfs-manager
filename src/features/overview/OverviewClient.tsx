import { Maximize2 } from 'lucide-react';
import { useRouter } from '@/lib/router';
import CalendarHeatmap from '@/components/charts/CalendarHeatmap';
import HourBars from '@/components/charts/HourBars';
import { NetworkMap } from '@/components/map';
import { ButtonLink } from '@/components/ui/Button';
import { MapSkeleton } from '@/components/ui/Skeleton';
import NetworkError from '@/features/network/NetworkError';
import { useNetwork } from '@/features/network/useNetwork';
import { useI18n } from '@/lib/i18n/client';

export function NetworkPreview({ feedId }: { feedId: string }) {
  const { t } = useI18n();
  const { data, error, retry } = useNetwork(feedId);
  const router = useRouter();
  return (
    <div className="relative h-[360px] overflow-hidden rounded-md md:h-[440px]">
      {data ? (
        <NetworkMap
          data={data}
          label={t('nav.map')}
          onStopClick={(s) => router.push(`/feeds/${feedId}/stops/${encodeURIComponent(s.stopId)}`)}
          onRouteClick={(id) => router.push(`/feeds/${feedId}/routes/${encodeURIComponent(id)}`)}
        />
      ) : error ? (
        <NetworkError onRetry={retry} />
      ) : (
        <MapSkeleton />
      )}
      <ButtonLink
        href={`/feeds/${feedId}/map`}
        variant="tonal"
        size="sm"
        className="absolute right-3 top-3 z-[500]"
      >
        <Maximize2 />
        {t('overview.openMap')}
      </ButtonLink>
    </div>
  );
}

export function TripsHeatmap({
  feedId,
  data,
}: {
  feedId: string;
  data: { date: string; trips: number }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <CalendarHeatmap
      data={data}
      unit={(n) => t('units.trips', { count: n })}
      onSelect={(date) => router.push(`/feeds/${feedId}/calendar?date=${date}`)}
    />
  );
}

export function DeparturesByHour({ values }: { values: number[] }) {
  const { t } = useI18n();
  return <HourBars values={values} unit={(n) => t('units.departures', { count: n })} />;
}
