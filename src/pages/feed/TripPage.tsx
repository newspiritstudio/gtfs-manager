import { formatClock } from '@shared/gtfs-values';
import { useParams } from 'react-router';
import CrumbLabel from '@/components/shell/CrumbLabel';
import Loaded from '@/components/shell/Loaded';
import { TripSkeleton } from '@/components/skeletons/PageSkeletons';
import TripView from '@/features/trips/TripView';
import { useEngine } from '@/lib/engine';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

type TripDetail = NonNullable<ReturnType<typeof useEngine<'getTripDetail'>>['data']>;

/** The train number if it has one; otherwise the departure time (the id is often an unreadable hash). */
function labelOf(detail: TripDetail, id: string) {
  const first = detail.stopTimes[0];
  const start = first?.departure ?? first?.arrival ?? null;
  const name = detail.trip.shortName || (start !== null ? formatClock(start) : id);
  return [name, detail.trip.headsign].filter(Boolean).join(' → ');
}

export default function TripPage() {
  const feedId = useFeedId();
  const { tripId = '' } = useParams();
  const detail = useEngine('getTripDetail', feedId, tripId);
  useDocumentHead({ title: detail.data ? labelOf(detail.data, tripId) : tripId });
  return (
    <Loaded state={detail} skeleton={<TripSkeleton />}>
      {(data) => (
        <div className="mx-auto max-w-7xl">
          <CrumbLabel
            label={labelOf(data, tripId)}
            parent={
              data.route
                ? {
                    label: data.route.shortName || data.route.longName || data.route.routeId,
                    href: `/feeds/${feedId}/routes/${encodeURIComponent(data.route.routeId)}`,
                  }
                : undefined
            }
          />
          <TripView key={tripId} feedId={feedId} detail={data} />
        </div>
      )}
    </Loaded>
  );
}
