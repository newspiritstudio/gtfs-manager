import { ChevronDown, Download, FileArchive, Map as MapIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Button from '@/components/ui/Button';
import { FLOATING_LIST, useFloatingPlacement } from '@/components/ui/floating';
import { useToast } from '@/components/ui/Toast';
import { downloadFrom } from '@/lib/api';
import { useI18n } from '@/lib/i18n/client';

/** The export menu: the feed as a GTFS ZIP or as GeoJSON, both built by the engine in the browser. */
export default function ExportButton({ feedId }: { feedId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const style = useFloatingPlacement(open, triggerRef);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !listRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    listRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const items = [
    { key: 'zip', label: t('outputs.exportZip'), icon: <FileArchive />, path: 'export' },
    {
      key: 'geojson',
      label: t('outputs.exportGeojson'),
      icon: <MapIcon />,
      path: 'export/geojson',
    },
  ];
  const run = (path: string) => {
    setOpen(false);
    triggerRef.current?.focus();
    setBusy(true);
    downloadFrom(`/api/feeds/${feedId}/${path}`)
      .catch(() => toast(t('errors.generic'), 'error'))
      .finally(() => setBusy(false));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const nodes = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'ArrowDown') nodes[(at + 1) % nodes.length]?.focus();
    else if (event.key === 'ArrowUp') nodes[(at - 1 + nodes.length) % nodes.length]?.focus();
    else if (event.key === 'Home') nodes[0]?.focus();
    else if (event.key === 'End') nodes[nodes.length - 1]?.focus();
    else if (event.key !== 'Tab') return;
    if (event.key !== 'Tab') event.preventDefault();
    else setOpen(false);
  };

  return (
    <>
      <Button
        ref={triggerRef}
        variant="tonal"
        size="sm"
        loading={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Download />
        {t('feed.export')}
        <ChevronDown />
      </Button>
      {open
        ? createPortal(
            <ul
              ref={listRef}
              id={id}
              role="menu"
              aria-label={t('feed.export')}
              onKeyDown={onKeyDown}
              style={{
                ...style,
                width: undefined,
                minWidth: '14rem',
                left: Math.max(
                  8,
                  Math.min(Number(style.left ?? 0), window.innerWidth - 14 * 16 - 8)
                ),
              }}
              className={FLOATING_LIST}
            >
              {items.map((item) => (
                <li key={item.key} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => run(item.path)}
                    className="mx-1 flex min-h-11 w-[calc(100%-0.5rem)] items-center gap-3 rounded-sm px-2.5 py-2 text-left text-body-medium text-on-surface hover:bg-on-surface/[0.08] focus:bg-on-surface/[0.08] focus:outline-none md:min-h-10 [&_svg]:size-5 [&_svg]:text-on-surface-variant"
                  >
                    {item.icon}
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>,
            document.body
          )
        : null}
    </>
  );
}
