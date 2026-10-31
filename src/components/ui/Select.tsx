import { Check, ChevronDown } from 'lucide-react';
import { motion as m, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SPRING } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { FLOATING_LIST, useFloatingPlacement } from './floating';

export interface SelectOption {
  value: string;
  label: string;
  /** Icon at the start of the row and of the field (a flag, for example). */
  icon?: ReactNode;
  /** Secondary text on the right of the row (a count). */
  trailing?: string;
  /** The option's language, when it is not the page's (a language name). */
  lang?: string;
}

interface SelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  error?: string | null;
  id?: string;
  className?: string;
  /**
   * A compact trigger for a toolbar (this icon and the value, in a pill) instead of a form field;
   * the label is only for screen readers.
   */
  compactIcon?: ReactNode;
}

/**
 * MD3 dropdown with its own menu, never the browser's: a field like `TextField` and a list with an
 * optional icon, a count and a mark on the selected row. The list floats over the page (a portal),
 * so a dialog or a scrolling card does not clip it. ARIA listbox pattern: arrows, Home/End, Enter
 * or Space to select, Escape to close (without closing the dialog around it) and the first letter
 * to jump to an option.
 */
export default function Select({
  label,
  value,
  options,
  onChange,
  required,
  disabled,
  error,
  id: givenId,
  className,
  compactIcon,
}: SelectProps) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const listId = `${id}-list`;
  const messageId = `${id}-msg`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const reduced = useReducedMotion();
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex] as SelectOption | undefined;

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
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus({ preventScroll: true });
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const openAt = (index: number) => {
    if (disabled || !options.length) return;
    setActive(Math.max(0, index));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const choose = (index: number) => {
    if (options[index].value !== value) onChange(options[index].value);
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
      // Focus returns to the field before the list disappears, and Tab continues from there.
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      // A dialog around the field closes on Escape too: only the list should.
      event.stopPropagation();
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

  const chevron = (
    <m.span
      aria-hidden
      className="flex size-5 items-center justify-center text-on-surface-variant"
      animate={reduced ? false : { rotate: open ? 180 : 0 }}
      style={reduced ? { transform: open ? 'rotate(180deg)' : undefined } : undefined}
      transition={SPRING.fastSpatial}
    >
      <ChevronDown className="size-5" />
    </m.span>
  );
  const trigger = {
    ref: triggerRef,
    id,
    type: 'button' as const,
    role: 'combobox',
    disabled,
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': open,
    'aria-controls': open ? listId : undefined,
    'aria-labelledby': `${id}-label ${id}`,
    onClick: () => (open ? setOpen(false) : openAt(selectedIndex)),
    onKeyDown: onTriggerKey,
  };
  // A compact menu is as wide as its longest option, and stays inside the window.
  const listStyle =
    compactIcon && open
      ? {
          ...style,
          width: undefined,
          minWidth: '12rem',
          left: Math.max(8, Math.min(Number(style.left ?? 0), window.innerWidth - 12 * 16 - 8)),
        }
      : style;

  return (
    <div className={cn(compactIcon ? 'inline-flex' : 'space-y-1', className)}>
      {compactIcon ? (
        <button
          {...trigger}
          className="inline-flex h-10 items-center gap-1.5 rounded-full pr-2 pl-3 text-label-large text-on-surface hover:bg-on-surface/[0.08] focus-ring"
        >
          <span aria-hidden className="flex size-5 text-on-surface-variant">
            {compactIcon}
          </span>
          <span id={`${id}-label`} className="sr-only">
            {label}
          </span>
          <span lang={selected?.lang}>{selected?.label}</span>
          {chevron}
        </button>
      ) : (
        <div
          className={cn(
            'md3-field relative',
            error && 'md3-field--error',
            disabled && 'pointer-events-none opacity-[0.38]'
          )}
        >
          <button
            {...trigger}
            aria-required={required || undefined}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? messageId : undefined}
            className={cn(
              'md3-field-trigger flex h-12 w-full items-center gap-2 px-4 pt-4 pb-2 text-left text-body-large text-on-surface md:h-10 md:pt-3 md:pb-1',
              error && 'md3-field-trigger--error'
            )}
          >
            {selected?.icon ? <span className="flex size-5 shrink-0">{selected.icon}</span> : null}
            <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
            {chevron}
          </button>
          <label
            id={`${id}-label`}
            htmlFor={id}
            className={cn(
              'md3-field-label md3-field-label--floating',
              error && 'md3-field-label--error'
            )}
          >
            {label}
            {required ? (
              <span aria-hidden className="ml-0.5 text-error">
                *
              </span>
            ) : null}
          </label>
        </div>
      )}
      {error ? (
        <p id={messageId} className="px-4 text-body-small text-error">
          {error}
        </p>
      ) : null}
      {open
        ? createPortal(
            <m.ul
              ref={listRef}
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-labelledby={`${id}-label`}
              aria-activedescendant={`${id}-option-${active}`}
              onKeyDown={onListKey}
              initial={reduced ? false : { opacity: 0, y: style.bottom === undefined ? -4 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={SPRING.fastSpatial}
              style={listStyle}
              className={FLOATING_LIST}
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
                    {option.icon ? (
                      <span className="flex size-5 shrink-0">{option.icon}</span>
                    ) : null}
                    <span lang={option.lang} className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
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
            </m.ul>,
            document.body
          )
        : null}
    </div>
  );
}
