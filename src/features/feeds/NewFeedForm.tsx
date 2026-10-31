'use client';

import JSZip from 'jszip';
import {
  CheckCircle2,
  CloudDownload,
  FileArchive,
  FilePlus2,
  FileText,
  FolderOpen,
  RotateCcw,
  Sparkles,
  Upload,
  XCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileImportReport } from '@shared/contracts';
import { GTFS_TABLES, tableForFile } from '@shared/gtfs-spec';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/Tabs';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { apiFetch, ApiError, uploadWithProgress } from '@/lib/api';
import { formatNumber } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

interface PickedFile {
  name: string;
  size: number;
  load: () => Promise<Blob>;
}

type FileState =
  | { status: 'waiting' }
  | { status: 'uploading'; progress: number }
  | { status: 'processing' }
  | { status: 'done'; report: FileImportReport }
  | { status: 'failed'; error: string };

const ORDER = [...GTFS_TABLES.map((t) => `${t}.txt`)];

function sortFiles(files: PickedFile[]): PickedFile[] {
  const rank = (name: string) => {
    const i = ORDER.indexOf(name.toLowerCase());
    return i === -1 ? ORDER.length : i;
  };
  return [...files].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

function formatBytes(locale: string, bytes: number) {
  if (bytes >= 1024 * 1024)
    return `${formatNumber(locale, bytes / 1024 / 1024, { maximumFractionDigits: 1 })} MB`;
  return `${formatNumber(locale, Math.max(1, Math.round(bytes / 1024)))} kB`;
}

export interface CatalogPick {
  id: string;
  name: string;
  operator: string;
  region: string;
}

type DownloadState =
  { status: 'loading'; loaded: number; total: number | null } | { status: 'failed' } | null;

/** Downloads the ZIP of a catalog entry with progress (the server bridges to the source). */
async function downloadCatalog(
  id: string,
  signal: AbortSignal,
  onProgress: (loaded: number, total: number | null) => void
): Promise<File> {
  const response = await fetch(`/api/catalog/${encodeURIComponent(id)}/zip`, { signal });
  if (!response.ok || !response.body) throw new ApiError(response.status, 'sourceUnavailable');
  const total = Number(response.headers.get('content-length')) || null;
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  return new File(chunks, `${id}.zip`, { type: 'application/zip' });
}

function isHttpUrl(value: string): boolean {
  try {
    return /^https?:$/.test(new URL(value.trim()).protocol);
  } catch {
    return false;
  }
}

export default function NewFeedForm({ catalog = null }: { catalog?: CatalogPick | null }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<'import' | 'blank'>('import');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [states, setStates] = useState<Record<string, FileState>>({});
  const [name, setName] = useState(catalog?.name ?? '');
  const [description, setDescription] = useState(
    catalog ? `${catalog.operator} · ${catalog.region}` : ''
  );
  const [download, setDownload] = useState<DownloadState>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'stats'>('idle');
  const [dragging, setDragging] = useState(false);
  // The already-created feed if an import failed midway: it is resumed without duplicating it.
  const createdFeed = useRef<string | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [agency, setAgency] = useState({
    agency_name: '',
    agency_url: '',
    agency_timezone: 'Europe/Madrid',
    agency_lang: locale as string,
  });

  const busy = phase !== 'idle';
  // Nothing is flagged until the button is pressed: then empty required fields are marked.
  const [showErrors, setShowErrors] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const missing = (value: string) => (showErrors && !value.trim() ? t('data.fieldRequired') : null);
  const badUrl =
    showErrors && agency.agency_url.trim() && !isHttpUrl(agency.agency_url)
      ? t('data.fieldInvalid')
      : null;
  const invalid =
    !name.trim() ||
    (mode === 'import'
      ? !files.length
      : !agency.agency_name.trim() ||
        !isHttpUrl(agency.agency_url) ||
        !agency.agency_timezone.trim());
  function submit() {
    if (invalid) {
      setShowErrors(true);
      // Focus goes to the first field with an error; with no field (no file chosen), to the file picker.
      requestAnimationFrame(() =>
        (
          rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
          rootRef.current?.querySelector<HTMLElement>('[data-dropzone] button')
        )?.focus()
      );
      return;
    }
    void (mode === 'import' ? runImport() : createBlank());
  }

  const accept = useCallback(
    (picked: PickedFile[], suggested: string) => {
      if (!picked.length) {
        toast(t('newFeed.noTxt'), 'error');
        return;
      }
      setFiles(sortFiles(picked));
      setStates({});
      createdFeed.current = null;
      if (suggested) setName((current) => current || suggested.replace(/[_-]+/g, ' ').trim());
    },
    [t, toast]
  );

  const pickZip = useCallback(
    async (file: File, suggested = file.name.replace(/\.zip$/i, '')) => {
      try {
        const zip = await JSZip.loadAsync(file);
        const picked: PickedFile[] = [];
        zip.forEach((path, entry) => {
          const base = path.split('/').pop() ?? '';
          if (entry.dir || !/\.txt$/i.test(base) || base.startsWith('.')) return;
          picked.push({
            name: base,
            size:
              (entry as unknown as { _data?: { uncompressedSize?: number } })._data
                ?.uncompressedSize ?? 0,
            load: () => entry.async('blob'),
          });
        });
        accept(picked, suggested);
      } catch {
        toast(t('newFeed.zipError'), 'error');
      }
    },
    [accept, t, toast]
  );

  useEffect(() => {
    if (!catalog) return;
    const controller = new AbortController();
    setDownload({ status: 'loading', loaded: 0, total: null });
    downloadCatalog(catalog.id, controller.signal, (loaded, total) =>
      setDownload({ status: 'loading', loaded, total })
    )
      .then(async (file) => {
        await pickZip(file, '');
        setDownload(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDownload({ status: 'failed' });
      });
    return () => controller.abort();
  }, [catalog, attempt, pickZip]);

  function pickFiles(list: FileList | File[]) {
    const all = Array.from(list);
    const zip = all.find((f) => /\.zip$/i.test(f.name));
    if (zip) {
      void pickZip(zip);
      return;
    }
    const txt = all.filter((f) => /\.txt$/i.test(f.name) && !f.name.startsWith('.'));
    const folder =
      (all[0] as File & { webkitRelativePath?: string })?.webkitRelativePath?.split('/')[0] ?? '';
    accept(
      txt.map((f) => ({ name: f.name, size: f.size, load: async () => f })),
      folder
    );
  }

  async function runImport() {
    if (!files.length || !name.trim()) return;
    setPhase('uploading');
    let feedId = createdFeed.current;
    if (!feedId) {
      try {
        ({ id: feedId } = await apiFetch<{ id: string }>('/api/feeds', {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || null,
            origin: 'import',
            catalogId: catalog?.id ?? null,
          }),
        }));
        createdFeed.current = feedId;
      } catch {
        toast(t('errors.generic'), 'error');
        setPhase('idle');
        return;
      }
    }
    let failures = 0;
    for (const file of files) {
      if (states[file.name]?.status === 'done') continue;
      setStates((s) => ({ ...s, [file.name]: { status: 'uploading', progress: 0 } }));
      try {
        const blob = await file.load();
        const report = (await uploadWithProgress(
          `/api/feeds/${feedId}/files/${encodeURIComponent(file.name)}`,
          blob,
          (p) =>
            setStates((s) => ({
              ...s,
              [file.name]: p >= 1 ? { status: 'processing' } : { status: 'uploading', progress: p },
            }))
        )) as FileImportReport;
        setStates((s) => ({ ...s, [file.name]: { status: 'done', report } }));
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'requestFailed';
        setStates((s) => ({ ...s, [file.name]: { status: 'failed', error: code } }));
        failures++;
      }
    }
    if (failures) {
      // Do not enter the feed with files left unimported: they are shown and can be retried.
      toast(t('newFeed.failed'), 'error');
      setPhase('idle');
      return;
    }
    setPhase('stats');
    try {
      await apiFetch(`/api/feeds/${feedId}/stats`, { method: 'POST' });
    } catch {
      // The figures will be recomputed when the feed is opened.
    }
    toast(t('newFeed.imported'), 'success');
    router.push(`/feeds/${feedId}`);
    router.refresh();
  }

  async function createBlank() {
    if (!name.trim()) return;
    setPhase('uploading');
    try {
      const { id } = await apiFetch<{ id: string }>('/api/feeds', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          origin: 'blank',
          agency: { ...agency, agency_lang: agency.agency_lang || undefined },
        }),
      });
      toast(t('newFeed.created'), 'success');
      router.push(`/feeds/${id}/data`);
      router.refresh();
    } catch (error) {
      toast(
        error instanceof ApiError && error.code === 'invalidBody'
          ? t('errors.invalidForm')
          : t('errors.generic'),
        'error'
      );
      setPhase('idle');
    }
  }

  const totalSize = files.reduce((n, f) => n + f.size, 0);

  return (
    <div ref={rootRef} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader
          title={mode === 'import' ? t('newFeed.importTitle') : t('newFeed.blankTitle')}
          subtitle={mode === 'import' ? t('newFeed.importSubtitle') : t('newFeed.blankSubtitle')}
          icon={mode === 'import' ? <FolderOpen /> : <Sparkles />}
          actions={
            <SegmentedControl
              label={t('newFeed.mode')}
              value={mode}
              onChange={(v) => !busy && setMode(v)}
              options={[
                { value: 'import', label: t('newFeed.modeImport') },
                { value: 'blank', label: t('newFeed.modeBlank') },
              ]}
            />
          }
        />
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={t('feed.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              error={missing(name)}
              disabled={busy}
              maxLength={120}
            />
            <TextField
              label={t('feed.description')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              maxLength={500}
            />
          </div>
          {mode === 'import' && download ? (
            <div className="flex flex-col items-center gap-3 rounded-lg bg-surface-container-highest px-6 py-10 text-center">
              <span className="flex size-14 items-center justify-center rounded-xl bg-primary-tint text-primary [&_svg]:size-7">
                {download.status === 'failed' ? <XCircle /> : <CloudDownload />}
              </span>
              <p className="text-title-medium text-on-surface">
                {download.status === 'failed'
                  ? t('newFeed.downloadFailed')
                  : t('newFeed.downloading', { source: catalog?.operator ?? '' })}
              </p>
              {download.status === 'loading' ? (
                <>
                  <span
                    role="progressbar"
                    aria-label={t('newFeed.downloading', { source: catalog?.operator ?? '' })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={
                      download.total
                        ? Math.round((download.loaded / download.total) * 100)
                        : undefined
                    }
                    className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-surface-container"
                  >
                    <span
                      className={cn(
                        'block h-full rounded-full bg-primary transition-[width]',
                        !download.total && 'w-1/3 animate-pulse'
                      )}
                      style={
                        download.total
                          ? { width: `${(download.loaded / download.total) * 100}%` }
                          : undefined
                      }
                    />
                  </span>
                  <p className="min-h-4 text-body-small tabular-nums text-on-surface-variant">
                    {download.loaded ? formatBytes(locale, download.loaded) : ''}
                    {download.total ? ` / ${formatBytes(locale, download.total)}` : ''}
                  </p>
                </>
              ) : (
                <Button variant="tonal" onClick={() => setAttempt((n) => n + 1)}>
                  <RotateCcw />
                  {t('newFeed.retry')}
                </Button>
              )}
            </div>
          ) : mode === 'import' ? (
            <>
              {catalog && files.length ? null : (
                <div
                  data-dropzone
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                      setDragging(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    if (!busy) pickFiles(e.dataTransfer.files);
                  }}
                  className={cn(
                    'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
                    dragging ? 'border-primary bg-primary-tint-subtle' : 'border-outline-variant'
                  )}
                >
                  <span className="flex size-14 items-center justify-center rounded-xl bg-primary-tint text-primary [&_svg]:size-7">
                    <Upload />
                  </span>
                  <p className="text-title-medium text-on-surface">{t('newFeed.dropTitle')}</p>
                  <p className="max-w-md text-body-medium text-on-surface-variant">
                    {t('newFeed.dropHint')}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button
                      variant="tonal"
                      onClick={() => folderRef.current?.click()}
                      disabled={busy}
                    >
                      <FolderOpen />
                      {t('newFeed.pickFolder')}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => zipRef.current?.click()}
                      disabled={busy}
                    >
                      <FileArchive />
                      {t('newFeed.pickZip')}
                    </Button>
                  </div>
                  <input
                    ref={folderRef}
                    type="file"
                    className="hidden"
                    multiple
                    {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                    onChange={(e) => {
                      if (e.target.files) pickFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <input
                    ref={zipRef}
                    type="file"
                    accept=".zip,application/zip"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) pickFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </div>
              )}
              {showErrors && !files.length && !download ? (
                <p role="alert" className="text-body-small text-error">
                  {t('newFeed.needFiles')}
                </p>
              ) : null}
              {files.length ? (
                <ul
                  aria-live="polite"
                  className="divide-y divide-outline-variant/60 overflow-hidden rounded-md bg-surface-container-highest"
                >
                  {files.map((file) => {
                    const table = tableForFile(file.name);
                    const state = states[file.name] ?? { status: 'waiting' };
                    return (
                      <li key={file.name} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                        <FileText className="size-5 shrink-0 text-on-surface-variant" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body-medium text-on-surface">
                            {file.name}
                          </span>
                          <span className="text-body-small text-on-surface-muted">
                            {formatBytes(locale, file.size)}
                            {state.status === 'done'
                              ? ` · ${t('newFeed.rows', { count: state.report.inserted })}${
                                  state.report.duplicates
                                    ? ` · ${t('newFeed.duplicates', { count: state.report.duplicates })}`
                                    : ''
                                }`
                              : ''}
                          </span>
                        </span>
                        {table ? (
                          <Badge tone="primary">{t(`tables.${table}`)}</Badge>
                        ) : (
                          <Badge>{t('newFeed.extraFile')}</Badge>
                        )}
                        <span className="flex w-28 items-center justify-end">
                          {state.status === 'uploading' ? (
                            <span
                              role="progressbar"
                              aria-label={file.name}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(state.progress * 100)}
                              className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container"
                            >
                              <span
                                className="block h-full rounded-full bg-primary transition-[width]"
                                style={{ width: `${state.progress * 100}%` }}
                              />
                            </span>
                          ) : state.status === 'processing' ? (
                            <span className="text-label-medium text-primary">
                              {t('newFeed.processing')}
                            </span>
                          ) : state.status === 'done' ? (
                            <CheckCircle2
                              className="size-5 text-success"
                              role="img"
                              aria-label={t('newFeed.done')}
                            />
                          ) : state.status === 'failed' ? (
                            <span
                              className="flex items-center gap-1 text-label-medium text-critical"
                              title={state.error}
                            >
                              <XCircle aria-hidden className="size-5" /> {t('newFeed.failed')}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-title-small text-on-surface">{t('newFeed.agency')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label={t('fields.agency_name')}
                  value={agency.agency_name}
                  onChange={(e) => setAgency({ ...agency, agency_name: e.target.value })}
                  required
                  error={missing(agency.agency_name)}
                  disabled={busy}
                />
                <TextField
                  label={t('fields.agency_url')}
                  type="url"
                  value={agency.agency_url}
                  onChange={(e) => setAgency({ ...agency, agency_url: e.target.value })}
                  required
                  error={missing(agency.agency_url) ?? badUrl}
                  disabled={busy}
                  placeholder="https://"
                />
                <TextField
                  label={t('fields.agency_timezone')}
                  value={agency.agency_timezone}
                  onChange={(e) => setAgency({ ...agency, agency_timezone: e.target.value })}
                  required
                  error={missing(agency.agency_timezone)}
                  disabled={busy}
                />
                <TextField
                  label={t('fields.agency_lang')}
                  value={agency.agency_lang}
                  onChange={(e) => setAgency({ ...agency, agency_lang: e.target.value })}
                  disabled={busy}
                  maxLength={8}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <aside className="space-y-4">
        <Card>
          <CardHeader title={t('newFeed.summary')} icon={<FilePlus2 />} />
          <CardContent className="space-y-4">
            {mode === 'import' ? (
              <dl className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-surface-container-highest px-3 py-2">
                  <dt className="text-label-small text-on-surface-variant">{t('newFeed.files')}</dt>
                  <dd className="text-title-large tabular-nums">{files.length}</dd>
                </div>
                <div className="rounded-md bg-surface-container-highest px-3 py-2">
                  <dt className="text-label-small text-on-surface-variant">{t('newFeed.size')}</dt>
                  <dd className="text-title-large tabular-nums">
                    {files.length ? formatBytes(locale, totalSize) : '—'}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-body-medium text-on-surface-variant">{t('newFeed.blankNext')}</p>
            )}
            {phase === 'stats' ? (
              <p className="text-body-medium text-primary">{t('newFeed.computing')}</p>
            ) : null}
            <Button className="w-full" loading={busy} onClick={submit}>
              {mode === 'import'
                ? createdFeed.current
                  ? t('newFeed.retry')
                  : t('newFeed.import')
                : t('newFeed.create')}
            </Button>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
