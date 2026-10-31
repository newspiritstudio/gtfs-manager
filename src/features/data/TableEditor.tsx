import { ChevronLeft, ChevronRight, Pencil, Plus, Table2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from '@/lib/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TablePage, TableRow } from '@shared/contracts';
import { GTFS_SPEC, type GtfsTable } from '@shared/gtfs-spec';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import IconButton from '@/components/ui/IconButton';
import Modal from '@/components/ui/Modal';
import SearchField from '@/components/ui/SearchField';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { apiFetch, ApiError } from '@/lib/api';
import { formatNumber } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import RowForm, { enumLabel, type FieldErrors } from './RowForm';

const PAGE_SIZE = 50;

/** Remounted when the file or feed changes so columns and rows do not get mixed up. */
export default function TableEditor(props: { feedId: string; table: GtfsTable }) {
  return <TableEditorBody key={`${props.feedId}:${props.table}`} {...props} />;
}

function TableEditorBody({ feedId, table }: { feedId: string; table: GtfsTable }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const spec = GTFS_SPEC[table];
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(query);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TablePage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<{
    row: TableRow | null;
    values: Record<string, string>;
  } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (query === debounced) return;
    const handle = setTimeout(() => {
      setDebounced(query);
      setPage(1);
      const next = new URLSearchParams(params.toString());
      if (query) next.set('q', query);
      else next.delete('q');
      router.replace(`${pathname}${next.size ? `?${next}` : ''}`);
    }, 250);
    return () => clearTimeout(handle);
    // Only the typed search moves the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // When confirmation is requested, the button that was clicked disappears: focus moves to the new one.
  useEffect(() => {
    if (confirmDelete) confirmRef.current?.focus();
  }, [confirmDelete]);

  const load = () => setReloadKey((n) => n + 1);

  // Only the latest request counts: an old response (search or previous page) does not overwrite the new one.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    apiFetch<TablePage>(
      `/api/feeds/${feedId}/tables/${table}?page=${page}&pageSize=${PAGE_SIZE}&q=${encodeURIComponent(debounced)}`,
      { signal: controller.signal }
    )
      .then((result) => {
        // If the last row of the last page was deleted, go back to the last page that exists.
        if (!result.rows.length && result.total > 0 && page > 1) {
          setPage(Math.max(1, Math.ceil(result.total / PAGE_SIZE)));
          return;
        }
        setData(result);
        setLoading(false);
      })
      .catch((error) => {
        if (controller.signal.aborted || (error as Error).name === 'AbortError') return;
        setFailed(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [feedId, table, page, debounced, reloadKey]);

  const columns = useMemo(() => {
    const rows = data?.rows ?? [];
    const specCols = spec.fields
      .map((f) => f.name)
      .filter(
        (name) =>
          spec.fields.find((f) => f.name === name)?.required ||
          rows.some((r) => r.values[name] != null)
      );
    const extra = [
      ...new Set(
        rows
          .flatMap((r) => Object.keys(r.values))
          .filter((k) => !spec.fields.some((f) => f.name === k))
      ),
    ];
    return { specCols, extra };
  }, [data, spec]);

  function open(row: TableRow | null) {
    const values: Record<string, string> = {};
    for (const f of spec.fields) values[f.name] = row?.values[f.name] ?? '';
    setEditing({ row, values });
    setErrors({});
    setConfirmDelete(false);
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setErrors({});
    const body = JSON.stringify(
      Object.fromEntries(
        Object.entries(editing.values).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()])
      )
    );
    try {
      if (editing.row) {
        await apiFetch(`/api/feeds/${feedId}/tables/${table}/${editing.row.id}`, {
          method: 'PATCH',
          body,
        });
        toast(t('data.saved'));
      } else {
        await apiFetch(`/api/feeds/${feedId}/tables/${table}`, { method: 'POST', body });
        toast(t('data.created'));
      }
      setEditing(null);
      load();
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalidRow') {
        setErrors(error.details as FieldErrors);
        // Focus goes to the first field with an error so the screen reader reads its message.
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus()
        );
      } else if (error instanceof ApiError && error.code === 'duplicateKey')
        toast(t('data.conflict'), 'error');
      else toast(t('errors.generic'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing?.row) return;
    setSaving(true);
    try {
      await apiFetch(`/api/feeds/${feedId}/tables/${table}/${editing.row.id}`, {
        method: 'DELETE',
      });
      toast(t('data.deleted'));
      setEditing(null);
      load();
      router.refresh();
    } catch {
      toast(t('errors.generic'), 'error');
    } finally {
      setSaving(false);
    }
  }

  function renderCell(name: string, value: string | null) {
    if (value == null || value === '') return <span className="text-on-surface-muted">—</span>;
    const field = spec.fields.find((f) => f.name === name);
    if (field?.type === 'color') {
      return (
        <span className="flex items-center gap-2">
          <span
            className="size-4 rounded-xs ring-1 ring-outline-variant"
            style={{ backgroundColor: `#${value}` }}
          />
          {value}
        </span>
      );
    }
    if (field?.enumValues && Number.isFinite(Number(value)))
      return enumLabel(t, name, Number(value));
    return value;
  }

  // What identifies the row to a screen reader: the first non-empty value in the row.
  const rowName = (row: TableRow): string =>
    [...columns.specCols, ...columns.extra].map((c) => row.values[c]).find((v) => v) ??
    String(row.id);

  const from = data && data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.pageSize) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t('data.search')}
          label={t('data.search')}
          className="w-full sm:w-80"
        />
        {data ? (
          <span aria-live="polite" className="text-body-medium text-on-surface-variant">
            {t('units.rows', { count: data.total })}
          </span>
        ) : null}
        <Button className="ml-auto" onClick={() => open(null)}>
          <Plus />
          {t('data.add')}
        </Button>
      </div>

      {failed ? (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-lg bg-tonal py-12">
          <p className="text-body-medium text-on-surface-variant">{t('errors.generic')}</p>
          <Button variant="tonal" onClick={load}>
            {t('common.retry')}
          </Button>
        </div>
      ) : data === null ? (
        <TableSkeleton rows={12} columns={6} />
      ) : data.total === 0 && !debounced ? (
        <div className="rounded-lg bg-tonal">
          <EmptyState icon={<Table2 />} title={t('data.empty')} description={t('data.emptyHint')} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg bg-tonal">
          <div
            aria-busy={loading}
            className={cn(
              'max-h-[calc(var(--app-height,100dvh)-280px)] overflow-auto transition-opacity',
              loading && 'opacity-60'
            )}
          >
            <table
              aria-label={t(`tables.${table}`)}
              className="w-full border-separate border-spacing-0 text-body-medium"
            >
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 top-0 z-20 w-12 bg-surface-container-high"
                  >
                    <span className="sr-only">{t('common.edit')}</span>
                  </th>
                  {[...columns.specCols, ...columns.extra].map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className="sticky top-0 z-10 whitespace-nowrap bg-surface-container-high px-3 py-2 text-left text-label-medium text-on-surface-variant"
                    >
                      <span
                        title={
                          columns.extra.includes(c) ? t('data.extraColumns') : t(`fields.${c}`)
                        }
                      >
                        {c}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} className="group cursor-pointer" onClick={() => open(row)}>
                    <td className="sticky left-0 border-b border-outline-variant/40 bg-surface-container px-1 group-hover:bg-surface-container-highest">
                      <IconButton
                        label={`${t('common.edit')} · ${rowName(row)}`}
                        className="size-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          open(row);
                        }}
                      >
                        <Pencil />
                      </IconButton>
                    </td>
                    {[...columns.specCols, ...columns.extra].map((c) => (
                      <td
                        key={c}
                        className="max-w-72 truncate whitespace-nowrap border-b border-outline-variant/40 px-3 py-2 text-on-surface group-hover:bg-surface-container-highest"
                      >
                        {renderCell(c, row.values[c] ?? null)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length ? (
              <p className="py-8 text-center text-body-medium text-on-surface-variant">
                {t('common.noResults')}
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-outline-variant/60 px-3 py-2">
            <span
              aria-live="polite"
              className="text-body-small tabular-nums text-on-surface-variant"
            >
              {t('data.page', {
                from: formatNumber(locale, from),
                to: formatNumber(locale, to),
                total: formatNumber(locale, data.total),
              })}
            </span>
            <IconButton
              label={t('common.previous')}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft />
            </IconButton>
            <IconButton
              label={t('common.next')}
              disabled={to >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight />
            </IconButton>
          </div>
        </div>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.row ? t('data.editRow') : t('data.newRow')}
        closeLabel={t('common.close')}
        size="lg"
        footer={
          <div className="flex w-full flex-wrap items-center gap-2">
            {editing?.row ? (
              confirmDelete ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-body-small text-on-surface-variant">
                    {t('data.deleteConfirm')}
                  </span>
                  <Button
                    ref={confirmRef}
                    variant="destructive"
                    size="sm"
                    onClick={remove}
                    loading={saving}
                  >
                    {t('common.delete')}
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                  {t('common.delete')}
                </Button>
              )
            ) : null}
            <span className="ml-auto flex gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={save} loading={saving}>
                {t('common.save')}
              </Button>
            </span>
          </div>
        }
      >
        {editing ? (
          <>
            <RowForm
              feedId={feedId}
              table={table}
              values={editing.values}
              onChange={(values) => setEditing({ ...editing, values })}
              errors={errors}
            />
            {editing.row && columns.extra.some((c) => editing.row!.values[c] != null) ? (
              <div className="mt-4 rounded-md bg-surface-container-lowest p-3">
                <p className="text-label-medium text-on-surface-variant">
                  {t('data.extraColumns')}
                </p>
                <dl className="mt-1 grid grid-cols-2 gap-x-4 text-body-small">
                  {columns.extra.map((c) => (
                    <div key={c} className="flex gap-2">
                      <dt className="text-on-surface-muted">{c}</dt>
                      <dd className="truncate text-on-surface">{editing.row!.values[c] ?? '—'}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </>
        ) : null}
      </Modal>
    </div>
  );
}
