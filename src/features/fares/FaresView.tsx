import {
  ArrowRightLeft,
  BadgePercent,
  Clock,
  CreditCard,
  Layers,
  Network,
  Ticket,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import type { FaresData, Limited } from '@/engine/gtfs/fares';
import { formatClock } from '@shared/gtfs-values';
import { Link } from '@/lib/router';
import { formatDuration, formatNumber } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';

interface Column<R> {
  /** The GTFS field name; its label is `fields.<key>`. */
  key: string;
  render: (row: R) => React.ReactNode;
  align?: 'right';
}

function Dash() {
  return <span className="text-on-surface-variant">·</span>;
}

/** A read-only list: a real table, scrolling sideways on narrow screens. */
function FareTable<R>({
  title,
  icon,
  list,
  columns,
  hint,
}: {
  title: string;
  icon: React.ReactNode;
  list: Limited<R>;
  columns: Column<R>[];
  hint?: string;
}) {
  const { t, locale } = useI18n();
  if (!list.total) return null;
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={
          list.rows.length < list.total
            ? t('spec.fares.truncated', {
                shown: formatNumber(locale, list.rows.length),
                total: formatNumber(locale, list.total),
              })
            : formatNumber(locale, list.total)
        }
        icon={icon}
      />
      <CardContent>
        {hint ? <p className="mb-2 text-body-small text-on-surface-variant">{hint}</p> : null}
        <div className="max-h-[480px] overflow-auto rounded-md bg-surface-container-highest">
          <table className="w-full min-w-max text-left text-body-medium">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-surface-container-highest text-label-medium text-on-surface-variant">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={`px-3 py-2 font-medium ${c.align === 'right' ? 'text-right' : ''}`}
                  >
                    {t(`fields.${c.key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/60">
              {list.rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-1.5 text-on-surface ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}
                    >
                      {c.render(row) ?? <Dash />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** Fares v1 and v2 of a feed, as the files say them. */
export default function FaresView({ feedId, data }: { feedId: string; data: FaresData }) {
  const { t, locale } = useI18n();
  const text = (v: string | null) => (v === null || v === '' ? null : v);
  const idName = (id: string | null, name: string | null) =>
    id === null ? null : name && name !== id ? `${name} (${id})` : id;
  const money = (amount: string, currency: string) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount));
    } catch {
      return `${amount} ${currency}`;
    }
  };
  const enumText = (field: string, value: number | null) =>
    value === null ? null : t(`enums.${field}.${value}`);
  const routeLink = (id: string | null) =>
    id ? (
      <Link
        className="text-primary hover:underline"
        href={`/feeds/${feedId}/routes/${encodeURIComponent(id)}`}
      >
        {id}
      </Link>
    ) : null;
  const stopLink = (id: string | null) =>
    id ? (
      <Link
        className="text-primary hover:underline"
        href={`/feeds/${feedId}/stops/${encodeURIComponent(id)}`}
      >
        {id}
      </Link>
    ) : null;

  const total = Object.values(data).reduce((n, l: Limited<unknown>) => n + l.total, 0);
  if (!total) {
    return (
      <EmptyState
        icon={<Ticket />}
        title={t('spec.fares.emptyTitle')}
        description={t('spec.fares.emptyDescription')}
      />
    );
  }
  const v2 = data.products.total || data.legRules.total || data.transferRules.total;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {data.attributes.total ? <Badge tone="neutral">{t('spec.fares.versionOne')}</Badge> : null}
        {v2 ? <Badge tone="primary">{t('spec.fares.versionTwo')}</Badge> : null}
      </div>

      <FareTable
        title={t('spec.fares.products')}
        icon={<Ticket />}
        list={data.products}
        columns={[
          { key: 'fare_product_id', render: (r) => r.fareProductId },
          { key: 'fare_product_name', render: (r) => text(r.name) },
          { key: 'amount', align: 'right', render: (r) => money(r.amount, r.currency) },
          {
            key: 'rider_category_id',
            render: (r) => idName(r.riderCategoryId, r.riderCategoryName),
          },
          { key: 'fare_media_id', render: (r) => idName(r.fareMediaId, r.fareMediaName) },
        ]}
      />
      <FareTable
        title={t('spec.fares.legRules')}
        icon={<Layers />}
        hint={t('spec.fares.legRulesHint')}
        list={data.legRules}
        columns={[
          { key: 'leg_group_id', render: (r) => text(r.legGroupId) },
          { key: 'network_id', render: (r) => idName(r.networkId, r.networkName) },
          { key: 'from_area_id', render: (r) => idName(r.fromAreaId, r.fromAreaName) },
          { key: 'to_area_id', render: (r) => idName(r.toAreaId, r.toAreaName) },
          { key: 'from_timeframe_group_id', render: (r) => text(r.fromTimeframeGroupId) },
          { key: 'to_timeframe_group_id', render: (r) => text(r.toTimeframeGroupId) },
          { key: 'fare_product_id', render: (r) => idName(r.fareProductId, r.fareProductName) },
          {
            key: 'rule_priority',
            align: 'right',
            render: (r) => (r.rulePriority === null ? null : formatNumber(locale, r.rulePriority)),
          },
        ]}
      />
      <FareTable
        title={t('spec.fares.joinRules')}
        icon={<Network />}
        list={data.joinRules}
        columns={[
          { key: 'from_network_id', render: (r) => r.fromNetworkId },
          { key: 'to_network_id', render: (r) => r.toNetworkId },
          { key: 'from_stop_id', render: (r) => stopLink(r.fromStopId) },
          { key: 'to_stop_id', render: (r) => stopLink(r.toStopId) },
        ]}
      />
      <FareTable
        title={t('spec.fares.transferRules')}
        icon={<ArrowRightLeft />}
        list={data.transferRules}
        columns={[
          { key: 'from_leg_group_id', render: (r) => text(r.fromLegGroupId) },
          { key: 'to_leg_group_id', render: (r) => text(r.toLegGroupId) },
          {
            key: 'transfer_count',
            align: 'right',
            render: (r) =>
              r.transferCount === null
                ? null
                : r.transferCount === -1
                  ? t('spec.fares.unlimited')
                  : formatNumber(locale, r.transferCount),
          },
          {
            key: 'duration_limit',
            align: 'right',
            render: (r) =>
              r.durationLimit === null ? null : formatDuration(locale, r.durationLimit),
          },
          {
            key: 'duration_limit_type',
            render: (r) => enumText('duration_limit_type', r.durationLimitType),
          },
          {
            key: 'fare_transfer_type',
            render: (r) => enumText('fare_transfer_type', r.fareTransferType),
          },
          { key: 'fare_product_id', render: (r) => idName(r.fareProductId, r.fareProductName) },
        ]}
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <FareTable
          title={t('spec.fares.riderCategories')}
          icon={<Users />}
          list={data.riderCategories}
          columns={[
            { key: 'rider_category_id', render: (r) => r.riderCategoryId },
            { key: 'rider_category_name', render: (r) => r.name },
            {
              key: 'is_default_fare_category',
              render: (r) =>
                r.isDefault === 1 ? (
                  <Badge tone="primary">{t('enums.is_default_fare_category.1')}</Badge>
                ) : null,
            },
          ]}
        />
        <FareTable
          title={t('spec.fares.media')}
          icon={<CreditCard />}
          list={data.media}
          columns={[
            { key: 'fare_media_id', render: (r) => r.fareMediaId },
            { key: 'fare_media_name', render: (r) => text(r.name) },
            { key: 'fare_media_type', render: (r) => enumText('fare_media_type', r.type) },
          ]}
        />
      </div>
      <FareTable
        title={t('spec.fares.timeframes')}
        icon={<Clock />}
        list={data.timeframes}
        columns={[
          { key: 'timeframe_group_id', render: (r) => r.groupId },
          {
            key: 'start_time',
            render: (r) => (r.startTime === null ? null : formatClock(r.startTime)),
          },
          { key: 'end_time', render: (r) => (r.endTime === null ? null : formatClock(r.endTime)) },
          { key: 'service_id', render: (r) => r.serviceId },
        ]}
      />
      <FareTable
        title={t('spec.fares.attributes')}
        icon={<Ticket />}
        list={data.attributes}
        columns={[
          { key: 'fare_id', render: (r) => r.fareId },
          { key: 'price', align: 'right', render: (r) => money(r.price, r.currency) },
          { key: 'payment_method', render: (r) => enumText('payment_method', r.paymentMethod) },
          {
            key: 'transfers',
            render: (r) => enumText('transfers', r.transfers) ?? t('spec.fares.unlimited'),
          },
          {
            key: 'transfer_duration',
            align: 'right',
            render: (r) =>
              r.transferDuration === null ? null : formatDuration(locale, r.transferDuration),
          },
          { key: 'agency_id', render: (r) => text(r.agencyId) },
        ]}
      />
      <FareTable
        title={t('spec.fares.rules')}
        icon={<BadgePercent />}
        hint={t('spec.fares.rulesHint')}
        list={data.rules}
        columns={[
          { key: 'fare_id', render: (r) => r.fareId },
          { key: 'route_id', render: (r) => routeLink(r.routeId) },
          { key: 'origin_id', render: (r) => text(r.originId) },
          { key: 'destination_id', render: (r) => text(r.destinationId) },
          { key: 'contains_id', render: (r) => text(r.containsId) },
        ]}
      />
    </div>
  );
}
