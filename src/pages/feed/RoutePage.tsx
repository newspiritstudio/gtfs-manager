import { useParams } from 'react-router';
import CrumbLabel from '@/components/shell/CrumbLabel';
import Loaded from '@/components/shell/Loaded';
import { RouteDetailSkeleton } from '@/components/skeletons/PageSkeletons';
import RouteDetailView from '@/features/routes/RouteDetailView';
import { useEngine } from '@/lib/engine';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

export default function RoutePage() {
  const feedId = useFeedId();
  const { routeId = '' } = useParams();
  const detail = useEngine('getRouteDetail', feedId, routeId);
  const label = detail.data
    ? detail.data.route.shortName || detail.data.route.longName || routeId
    : routeId;
  useDocumentHead({ title: label });
  return (
    <Loaded state={detail} skeleton={<RouteDetailSkeleton />}>
      {(data) => (
        <div className="mx-auto max-w-7xl">
          <CrumbLabel label={label} />
          <RouteDetailView key={routeId} feedId={feedId} detail={data} />
        </div>
      )}
    </Loaded>
  );
}
