'use client';

import { useEffect, useId, useState } from 'react';
import {
  GTFS_SPEC,
  transitModeForRouteType,
  type GtfsField,
  type GtfsTable,
} from '@shared/gtfs-spec';
import { PointPickerMap } from '@/components/map';
import Select from '@/components/ui/Select';
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

/** Un camp que apunta a un altre fitxer: text lliure amb suggeriments del fitxer de destinació. */
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
  const listId = useId();
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    if (!field.ref) return;
    let alive = true;
    const handle = setTimeout(() => {
      apiFetch<{ value: string; label: string }[]>(
        `/api/feeds/${feedId}/references/${field.ref}?q=${encodeURIComponent(value)}`
      )
        .then((list) => alive && setOptions(list))
        .catch(() => alive && setOptions([]));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [feedId, field.ref, value]);
  return (
    <>
      <TextField
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={listId}
        required={field.required}
        error={error}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label !== o.value ? o.label : undefined}
          </option>
        ))}
      </datalist>
    </>
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
                onChange={(e) => set(field.name, e.target.value)}
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
          if (field.ref && field.ref !== table) {
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
                <input
                  type="color"
                  aria-label={`${label} · ${t('data.colorPicker')}`}
                  value={/^[0-9A-F]{6}$/i.test(value) ? `#${value}` : '#000000'}
                  onChange={(e) => set(field.name, e.target.value.slice(1).toUpperCase())}
                  className="mt-1 size-11 shrink-0 cursor-pointer md:size-10 rounded-sm border border-outline-variant bg-transparent"
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
                ['int', 'float', 'lat', 'lon'].includes(field.type) ? 'decimal' : undefined
              }
              onChange={(e) => set(field.name, e.target.value)}
            />
          );
        })}
      </div>
    </div>
  );
}
