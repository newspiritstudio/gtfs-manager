import { useEffect, useState } from 'react';
import {
  GTFS_SPEC,
  transitModeForRouteType,
  type GtfsField,
  type GtfsTable,
} from '@shared/gtfs-spec';
import { PointPickerMap } from '@/components/map';
import ColorSwatchPicker from '@/components/ui/ColorSwatchPicker';
import Combobox from '@/components/ui/Combobox';
import Select from '@/components/ui/Select';
import TextArea from '@/components/ui/TextArea';
import TextField from '@/components/ui/TextField';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n/client';
import type { Translate } from '@/lib/i18n/translate';
import { useNetwork } from '@/features/network/useNetwork';

export type FieldErrors = Record<string, 'required' | 'invalid'>;

export function enumLabel(t: Translate, field: string, value: number): string {
  if (field === 'route_type') return `${value} · ${t(`modes.${transitModeForRouteType(value)}`)}`;
  const key = `enums.${field}.${value}`;
  const label = t(key);
  return label === key ? String(value) : label;
}

function hintFor(t: Translate, field: GtfsField): string | undefined {
  if (field.type === 'time') return t('data.timeHint');
  if (field.type === 'date') return t('data.dateHint');
  if (field.type === 'color') return t('data.colorHint');
  return undefined;
}

/** A field that points to another file: free text with suggestions from the target file(s). */
function ReferenceField({
  feedId,
  field,
  label,
  value,
  onChange,
  error,
}: {
  feedId: string;
  field: GtfsField;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    const refs = field.refs ?? [];
    if (!refs.length) return;
    let alive = true;
    const handle = setTimeout(() => {
      Promise.all(
        refs.map((ref) =>
          apiFetch<{ value: string; label: string }[]>(
            `/api/feeds/${feedId}/references/${ref.table}?field=${ref.field}&q=${encodeURIComponent(value)}`
          ).catch(() => [])
        )
      ).then((lists) => {
        if (!alive) return;
        // A value defined by several files (a service in calendar and calendar_dates) is listed once.
        const seen = new Set<string>();
        setOptions(
          lists
            .flat()
            .filter((o) => !seen.has(o.value) && seen.add(o.value))
            .slice(0, 30)
        );
      });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [feedId, field.refs, value]);
  return (
    <Combobox
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      required={field.required}
      error={error}
    />
  );
}

export default function RowForm({
  feedId,
  table,
  values,
  onChange,
  errors,
}: {
  feedId: string;
  table: GtfsTable;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  errors: FieldErrors;
}) {
  const { t } = useI18n();
  const spec = GTFS_SPEC[table];
  const set = (name: string, value: string) => onChange({ ...values, [name]: value });
  const errorText = (name: string) =>
    errors[name] === 'required'
      ? t('data.fieldRequired')
      : errors[name] === 'invalid'
        ? t('data.fieldInvalid')
        : null;
  const isStop = table === 'stops';
  const { data: network } = useNetwork(feedId, table === 'stops');
  const lat = Number(values.stop_lat);
  const lon = Number(values.stop_lon);
  const point =
    isStop && values.stop_lat && values.stop_lon && Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon }
      : null;

  return (
    <div className="space-y-4">
      {isStop ? (
        <div>
          <p className="mb-2 text-body-small text-on-surface-variant">{t('data.pickOnMap')}</p>
          <div className="h-64 overflow-hidden rounded-md">
            <PointPickerMap
              label={t('data.pickOnMap')}
              value={point}
              bounds={network?.bbox ?? null}
              context={network?.stops.map((s) => ({ lat: s.lat, lon: s.lon }))}
              onChange={(la, lo) =>
                onChange({ ...values, stop_lat: String(la), stop_lon: String(lo) })
              }
            />
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {spec.fields.map((field) => {
          const label = `${t(`fields.${field.name}`)} · ${field.name}`;
          const value = values[field.name] ?? '';
          if (field.enumValues) {
            return (
              <Select
                key={field.name}
                label={label}
                value={value}
                required={field.required}
                error={errorText(field.name)}
                onChange={(v) => set(field.name, v)}
                options={[
                  { value: '', label: t('data.noValue') },
                  ...field.enumValues.map((v) => ({
                    value: String(v),
                    label: enumLabel(t, field.name, v),
                  })),
                ]}
              />
            );
          }
          if (field.choices) {
            return (
              <Select
                key={field.name}
                label={label}
                value={value}
                required={field.required}
                error={errorText(field.name)}
                onChange={(v) => set(field.name, v)}
                options={[
                  { value: '', label: t('data.noValue') },
                  ...field.choices.map((v) => ({ value: v, label: v })),
                ]}
              />
            );
          }
          if (field.type === 'json') {
            return (
              <div key={field.name} className="sm:col-span-2">
                <TextArea
                  label={label}
                  value={value}
                  required={field.required}
                  error={errorText(field.name)}
                  helper={t('spec.jsonHint')}
                  spellCheck={false}
                  className="font-mono"
                  onChange={(e) => set(field.name, e.target.value)}
                />
              </div>
            );
          }
          if (
            field.refs?.length &&
            !(
              field.refs.length === 1 &&
              field.refs[0].table === table &&
              field.refs[0].field === field.name
            )
          ) {
            return (
              <ReferenceField
                key={field.name}
                feedId={feedId}
                field={field}
                label={label}
                value={value}
                onChange={(v) => set(field.name, v)}
                error={errorText(field.name)}
              />
            );
          }
          if (field.type === 'color') {
            return (
              <div key={field.name} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <TextField
                    label={label}
                    value={value}
                    onChange={(e) => set(field.name, e.target.value.replace('#', '').toUpperCase())}
                    required={field.required}
                    error={errorText(field.name)}
                    helper={hintFor(t, field)}
                    maxLength={6}
                  />
                </div>
                <ColorSwatchPicker
                  label={`${label} · ${t('data.colorPicker')}`}
                  value={value}
                  onChange={(color) => set(field.name, color)}
                />
              </div>
            );
          }
          return (
            <TextField
              key={field.name}
              label={label}
              value={value}
              required={field.required}
              error={errorText(field.name)}
              helper={hintFor(t, field)}
              inputMode={
                ['int', 'float', 'lat', 'lon', 'amount'].includes(field.type)
                  ? 'decimal'
                  : undefined
              }
              onChange={(e) => set(field.name, e.target.value)}
            />
          );
        })}
      </div>
    </div>
  );
}
