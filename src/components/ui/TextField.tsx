'use client';

import { forwardRef, useId } from 'react';
import { cn } from '@/lib/utils';

interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  error?: string | null;
  helper?: string;
}

/** Camp de text MD3 amb etiqueta flotant (les mateixes classes `md3-field-*` que l'Àgora). */
const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, helper, className, id, required, ...props },
  ref
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const messageId = `${fieldId}-msg`;
  return (
    <div className="space-y-1">
      <div className={cn('md3-field relative', error && 'md3-field--error')}>
        <input
          ref={ref}
          id={fieldId}
          placeholder=" "
          required={required}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error || helper ? messageId : undefined}
          className={cn(
            'md3-field-input peer block w-full h-12 md:h-10 px-4 pt-4 pb-2 md:pt-3 md:pb-1 text-body-large text-on-surface',
            error && 'md3-field-input--error',
            className
          )}
          {...props}
        />
        <label
          htmlFor={fieldId}
          className={cn('md3-field-label', error && 'md3-field-label--error')}
        >
          {label}
          {required ? <span className="ml-0.5 text-error">*</span> : null}
        </label>
      </div>
      {error || helper ? (
        <p
          id={messageId}
          className={cn('px-4 text-body-small', error ? 'text-error' : 'text-on-surface-variant')}
        >
          {error ?? helper}
        </p>
      ) : null}
    </div>
  );
});

export default TextField;
