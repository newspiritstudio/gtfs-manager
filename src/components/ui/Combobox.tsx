import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { FLOATING_LIST, useFloatingPlacement } from './floating';
import TextField from './TextField';

export interface ComboboxOption {
  value: string;
  /** A description shown beside the value (a stop's name next to its id). */
  label?: string;
}

interface ComboboxProps {
  label: string;
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  required?: boolean;
  error?: string | null;
  helper?: string;
}

/**
 * Free text with suggestions in an MD3 menu, never the browser's own list: the caller filters the
 * options by the text. ARIA combobox pattern: arrows move through the suggestions, Enter takes the
 * highlighted one, Escape closes the list (without closing the dialog around it).
 */
export default function Combobox({
  label,
  value,
  options,
  onChange,
  required,
  error,
  helper,
}: ComboboxProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = open && options.length > 0;
  const style = useFloatingPlacement(shown, inputRef);

  const choose = (option: ComboboxOption) => {
    onChange(option.value);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!shown) {
        setOpen(true);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => Math.max(0, Math.min(options.length - 1, i + step)));
    } else if (event.key === 'Enter' && shown && active >= 0) {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === 'Escape' && shown) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <>
      <TextField
        ref={inputRef}
        label={label}
        value={value}
        required={required}
        error={error}
        helper={helper}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown && active >= 0 ? `${id}-option-${active}` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {shown
        ? createPortal(
            <ul
              id={listId}
              role="listbox"
              aria-label={label}
              style={style}
              className={FLOATING_LIST}
            >
              {options.map((option, index) => (
                <li
                  key={option.value}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={index === active}
                  // The field keeps the focus: a press on the list must not blur it first.
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                  className={cn(
                    'mx-1 flex min-h-11 cursor-pointer items-baseline gap-3 rounded-sm px-2.5 py-2 text-body-medium md:min-h-10',
                    option.value === value ? 'text-primary' : 'text-on-surface',
                    index === active && 'bg-on-surface/[0.08]'
                  )}
                >
                  <span className="shrink-0 font-medium">{option.value}</span>
                  {option.label && option.label !== option.value ? (
                    <span className="min-w-0 flex-1 truncate text-on-surface-variant">
                      {option.label}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>,
            document.body
          )
        : null}
    </>
  );
}
