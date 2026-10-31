import { useParams } from 'react-router';
import CrumbLabel from '@/components/shell/CrumbLabel';
import Loaded from '@/components/shell/Loaded';
import { StopDetailSkeleton } from '@/components/skeletons/PageSkeletons';
import StopDetailView from '@/features/stops/StopDetailView';
import { useEngine } from '@/lib/engine';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

export default function StopPage() {
  const feedId = useFeedId();
  const { stopId = '' } = useParams();
  const detail = useEngine('getStopDetail', feedId, stopId);
  const label = detail.data?.stop.name || stopId;
  useDocumentHead({ title: label });
  return (
    <Loaded state={detail} skeleton={<StopDetailSkeleton />}>
      {(data) => (
        <div className="mx-auto max-w-7xl">
          <CrumbLabel label={label} />
          <StopDetailView key={stopId} feedId={feedId} detail={data} />
        </div>
      )}
    </Loaded>
  );
}
