import { forwardRef, useId } from 'react';
import { cn } from '@/lib/utils';

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string | null;
  helper?: string;
}

/** The MD3 text field for several lines (JSON, long descriptions); the label always floats. */
const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, error, helper, className, id, required, rows = 6, ...props },
  ref
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const messageId = `${fieldId}-msg`;
  return (
    <div className="space-y-1">
      <div className={cn('md3-field relative', error && 'md3-field--error')}>
        <textarea
          ref={ref}
          id={fieldId}
          rows={rows}
          required={required}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error || helper ? messageId : undefined}
          className={cn(
            'md3-field-input peer block w-full resize-y px-4 pb-2 pt-6 text-body-medium text-on-surface',
            error && 'md3-field-input--error',
            className
          )}
          {...props}
        />
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

export default TextArea;
