import { Check } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { readableTextColor } from '@shared/gtfs-values';
import { cn } from '@/lib/utils';
import { useFloatingPlacement } from './floating';

/** Usual line colours; any other is typed in the hex field beside the swatch. */
const SWATCHES = [
  'E53935',
  'D81B60',
  '8E24AA',
  '5E35B1',
  '3949AB',
  '1E88E5',
  '039BE5',
  '00ACC1',
  '00897B',
  '43A047',
  '7CB342',
  'C0CA33',
  'FDD835',
  'FFB300',
  'FB8C00',
  'F4511E',
  'B71C1C',
  '0D47A1',
  '1B5E20',
  '6D4C41',
  '757575',
  '546E7A',
  '000000',
  'FFFFFF',
];
const COLUMNS = 6;

/**
 * A swatch that opens an MD3 palette (not the system colour picker). `value` is a GTFS colour:
 * six hex digits without `#`. Arrows move through the palette, Enter or Space picks, Escape closes.
 */
export default function ColorSwatchPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const placement = useFloatingPlacement(open, buttonRef);
  const current = /^[0-9A-F]{6}$/i.test(value) ? value.toUpperCase() : null;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !gridRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  useEffect(() => {
    if (open) gridRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus();
  }, [open, active]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onGridKey = (event: KeyboardEvent) => {
    const last = SWATCHES.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    if (event.key in moves) {
      event.preventDefault();
      setActive((i) => Math.max(0, Math.min(last, i + moves[event.key])));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // A dialog around the field closes on Escape too: only the palette should.
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-palette` : undefined}
        onClick={() => {
          const index = current ? SWATCHES.indexOf(current) : -1;
          setActive(Math.max(0, index));
          setOpen((o) => !o);
        }}
        className="mt-1 size-11 shrink-0 rounded-sm border border-outline-variant p-1 focus-ring md:size-10"
      >
        <span
          className={cn('block size-full rounded-xs', !current && 'bg-surface-container-high')}
          style={current ? { backgroundColor: `#${current}` } : undefined}
        />
      </button>
      {open
        ? createPortal(
            <div
              ref={gridRef}
              id={`${id}-palette`}
              role="dialog"
              aria-label={label}
              onKeyDown={onGridKey}
              style={{
                top: placement.top,
                bottom: placement.bottom,
                left: placement.left,
              }}
              className="fixed z-popover grid grid-cols-6 gap-1.5 rounded-lg border border-outline-variant bg-floating p-2"
            >
              {SWATCHES.map((swatch, index) => (
                <button
                  key={swatch}
                  type="button"
                  data-index={index}
                  tabIndex={index === active ? 0 : -1}
                  aria-label={`#${swatch}`}
                  aria-pressed={swatch === current}
                  onClick={() => {
                    onChange(swatch);
                    close();
                  }}
                  className="flex size-8 items-center justify-center rounded-full border border-outline-variant focus-ring"
                  style={{ backgroundColor: `#${swatch}`, color: `#${readableTextColor(swatch)}` }}
                >
                  {swatch === current ? <Check aria-hidden className="size-4" /> : null}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
