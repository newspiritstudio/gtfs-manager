import { Copy, Plus, Trash2 } from 'lucide-react';
import type { PatternInfo } from '@shared/editing';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

/** The route's patterns by direction, with their stops and trips; pick one to edit it. */
export default function PatternList({
  patterns,
  selectedKey,
  creating,
  disabled,
  onSelect,
  onNew,
  onDuplicate,
  onDelete,
}: {
  patterns: PatternInfo[];
  selectedKey: string | null;
  /** A new pattern is being drafted (it has no entry in the list yet). */
  creating: boolean;
  disabled: boolean;
  onSelect: (key: string) => void;
  onNew: () => void;
  onDuplicate: (key: string) => void;
  onDelete: (key: string) => void;
}) {
  const { t } = useI18n();
  const directions = [...new Set(patterns.map((p) => p.directionId))].sort(
    (a, b) => (a ?? 9) - (b ?? 9)
  );
  const heading = (d: number | null) =>
    d === 0
      ? t('editor.patterns.direction0')
      : d === 1
        ? t('editor.patterns.direction1')
        : t('editor.patterns.directionNone');
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-title-small text-on-surface">{t('editor.patterns.title')}</h2>
        <Button variant="tonal" size="sm" onClick={onNew} disabled={disabled}>
          <Plus />
          {t('editor.patterns.new')}
        </Button>
      </div>
      {creating ? (
        <p className="rounded-md bg-primary/[0.08] px-3 py-2 text-body-small text-on-surface">
          {t('editor.patterns.drafting')}
        </p>
      ) : null}
      {directions.map((d) => (
        <section key={String(d)} aria-label={heading(d)} className="space-y-1.5">
          <h3 className="px-1 text-label-medium text-on-surface-variant">{heading(d)}</h3>
          <ul className="space-y-1.5">
            {patterns
              .filter((p) => p.directionId === d)
              .map((p) => {
                const first = p.stops[0]?.name ?? p.stops[0]?.stopId ?? '';
                const last = p.stops[p.stops.length - 1];
                const on = !creating && p.key === selectedKey;
                return (
                  <li
                    key={p.key}
                    className={cn(
                      'flex items-stretch rounded-md border',
                      on
                        ? 'border-primary bg-primary/[0.08]'
                        : 'border-outline-variant/60 bg-surface-container'
                    )}
                  >
                    <button
                      type="button"
                      aria-current={on ? 'true' : undefined}
                      disabled={disabled}
                      onClick={() => onSelect(p.key)}
                      className="min-w-0 flex-1 rounded-md px-3 py-2 text-left focus-ring"
                    >
                      <span className="block truncate text-body-medium text-on-surface">
                        {first} → {last?.name ?? last?.stopId}
                      </span>
                      <span className="block truncate text-label-small text-on-surface-variant">
                        {p.headsign ? `${p.headsign} · ` : ''}
                        {t('units.stops', { count: p.stops.length })} ·{' '}
                        {t('units.trips', { count: p.trips })}
                      </span>
                    </button>
                    <div className="flex flex-col justify-center pr-1">
                      <IconButton
                        label={t('editor.patterns.duplicate')}
                        disabled={disabled}
                        onClick={() => onDuplicate(p.key)}
                        className="size-9"
                      >
                        <Copy />
                      </IconButton>
                      <IconButton
                        label={t('editor.patterns.delete')}
                        disabled={disabled}
                        onClick={() => onDelete(p.key)}
                        className="size-9"
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
