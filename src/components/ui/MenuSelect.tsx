'use client';

import { Check, ChevronDown } from 'lucide-react';
import { motion as m, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { SPRING } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface MenuSelectOption {
  value: string;
  label: string;
  /** Icona al començament de la fila i del camp (una bandera, per exemple). */
  icon?: ReactNode;
  /** Text secundari a la dreta de la fila (un recompte). */
  trailing?: string;
}

interface MenuSelectProps {
  label: string;
  value: string;
  options: MenuSelectOption[];
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Desplegable de MD3 amb menú propi (no el natiu): el camp és el mateix que `Select` i la llista
 * porta icona, recompte i la marca de la fila triada, com el `Dropdown` de l'Àgora. Patró ARIA
 * listbox: fletxes, Inici/Fi, Retorn o espai per triar, Escape per tancar i la primera lletra per
 * saltar a una opció.
 */
export default function MenuSelect({
  label,
  value,
  options,
  onChange,
  className,
}: MenuSelectProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const reduced = useReducedMotion();
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const choose = (index: number) => {
    onChange(options[index].value);
    close();
  };

  const onTriggerKey = (event: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      openAt(selectedIndex);
    }
  };

  const onListKey = (event: KeyboardEvent) => {
    const last = options.length - 1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((i) => Math.min(last, i + 1)),
      ArrowUp: () => setActive((i) => Math.max(0, i - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => choose(active),
      ' ': () => choose(active),
      Escape: close,
    };
    if (event.key === 'Tab') {
      // El focus torna al camp abans que la llista desaparegui, i el Tab continua des d'allà.
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      action();
      return;
    }
    if (event.key.length === 1) {
      const letter = event.key.toLocaleLowerCase();
      const after = options.findIndex(
        (o, i) => i > active && o.label.toLocaleLowerCase().startsWith(letter)
      );
      const found =
        after >= 0
          ? after
          : options.findIndex((o) => o.label.toLocaleLowerCase().startsWith(letter));
      if (found >= 0) setActive(found);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div className="md3-field relative">
        <button
          ref={triggerRef}
          id={`${id}-trigger`}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-labelledby={`${id}-label ${id}-trigger`}
          onClick={() => (open ? setOpen(false) : openAt(selectedIndex))}
          onKeyDown={onTriggerKey}
          className="md3-field-trigger flex h-12 w-full items-center gap-2 px-4 pt-4 pb-2 text-left text-body-large text-on-surface md:h-10 md:pt-3 md:pb-1"
        >
          {selected?.icon ? <span className="flex size-5 shrink-0">{selected.icon}</span> : null}
          <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
          <m.span
            aria-hidden
            className="flex size-5 items-center justify-center text-on-surface-variant"
            animate={reduced ? false : { rotate: open ? 180 : 0 }}
            style={reduced ? { transform: open ? 'rotate(180deg)' : undefined } : undefined}
            transition={SPRING.fastSpatial}
          >
            <ChevronDown className="size-5" />
          </m.span>
        </button>
        <label
          id={`${id}-label`}
          htmlFor={`${id}-trigger`}
          className="md3-field-label md3-field-label--floating"
        >
          {label}
        </label>
      </div>
      {open ? (
        <m.ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={`${id}-option-${active}`}
          onKeyDown={onListKey}
          initial={reduced ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING.fastSpatial}
          className="absolute inset-x-0 top-full z-popover mt-1 max-h-80 overflow-auto rounded-lg border border-outline-variant bg-floating py-1 outline-none"
        >
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
            return (
              <li
                key={option.value}
                id={`${id}-option-${index}`}
                data-index={index}
                role="option"
                aria-selected={isSelected}
                onPointerEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={cn(
                  'mx-1 flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2.5 py-2 text-body-medium md:min-h-10',
                  isSelected ? 'bg-primary-tint text-primary' : 'text-on-surface',
                  index === active && !isSelected && 'bg-on-surface/[0.08]'
                )}
              >
                {option.icon ? <span className="flex size-5 shrink-0">{option.icon}</span> : null}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.trailing ? (
                  <span className="text-label-medium tabular-nums text-on-surface-variant">
                    {option.trailing}
                  </span>
                ) : null}
                <Check
                  aria-hidden
                  className={cn('size-4 shrink-0 text-primary', !isSelected && 'invisible')}
                />
              </li>
            );
          })}
        </m.ul>
      ) : null}
    </div>
  );
}
