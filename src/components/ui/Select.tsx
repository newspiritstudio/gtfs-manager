'use client';

import { ChevronDown } from 'lucide-react';
import { useId } from 'react';
import { cn } from '@/lib/utils';

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label: string;
  options: { value: string; label: string }[];
  error?: string | null;
}

/** Dropdown whose trigger is identical to a text field (native: on mobile, the system sheet). */
export default function Select({
  label,
  options,
  error,
  className,
  id,
  required,
  ...props
}: SelectProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const messageId = `${fieldId}-msg`;
  return (
    <div className="space-y-1">
      <div className={cn('md3-field relative', error && 'md3-field--error')}>
        <select
          id={fieldId}
          required={required}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? messageId : undefined}
          className={cn(
            'md3-field-trigger block w-full h-12 md:h-10 appearance-none pl-4 pr-10 pt-4 pb-2 md:pt-3 md:pb-1 text-body-large text-on-surface bg-transparent',
            error && 'md3-field-trigger--error',
            className
          )}
          {...props}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label
          htmlFor={fieldId}
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
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 size-5 -translate-y-1/2 text-on-surface-variant"
        />
      </div>
      {error ? (
        <p id={messageId} className="px-4 text-body-small text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
