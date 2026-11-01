import { useParams } from 'react-router';
import CrumbLabel from '@/components/shell/CrumbLabel';
import Loaded from '@/components/shell/Loaded';
import { RouteDetailSkeleton } from '@/components/skeletons/PageSkeletons';
import RouteEditView from '@/features/editor/RouteEditView';
import { useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

export default function RouteEditPage() {
  const feedId = useFeedId();
  const { t } = useI18n();
  const { routeId = '' } = useParams();
  const detail = useEngine('getRouteHeader', feedId, routeId);
  const name = detail.data
    ? detail.data.route.shortName || detail.data.route.longName || routeId
    : routeId;
  useDocumentHead({ title: `${t('common.edit')} · ${name}` });
  return (
    <Loaded state={detail} skeleton={<RouteDetailSkeleton />}>
      {(data) => (
        <div className="mx-auto max-w-[96rem]">
          <CrumbLabel label={`${name} · ${t('common.edit')}`} />
          <RouteEditView
            key={routeId}
            feedId={feedId}
            route={{
              routeId: data.route.routeId,
              shortName: data.route.shortName ?? '',
              longName: data.route.longName ?? '',
              color: data.route.color,
              textColor: data.route.textColor,
            }}
          />
        </div>
      )}
    </Loaded>
  );
}
