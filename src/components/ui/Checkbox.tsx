import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * MD3 checkbox: an 18 dp box with a 2 dp outline that fills with `primary` and a check when on, a
 * state layer around it, and the label beside it. The native input stays (invisible) for the
 * keyboard, forms and screen readers.
 */
export default function Checkbox({
  checked,
  onChange,
  children,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'group flex min-h-11 cursor-pointer items-center gap-3 px-1 text-body-medium text-on-surface md:min-h-10',
        disabled && 'cursor-not-allowed opacity-[0.38]',
        className
      )}
    >
      <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full group-hover:bg-on-surface/[0.08] has-[:focus-visible]:bg-on-surface/[0.12]">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 cursor-[inherit] opacity-0"
        />
        <span
          aria-hidden
          className={cn(
            'flex size-[18px] items-center justify-center rounded-[2px] border-2 transition-colors peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--md-sys-color-secondary)]',
            checked ? 'border-primary bg-primary text-on-primary' : 'border-on-surface-variant'
          )}
        >
          {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
        </span>
      </span>
      {children}
    </label>
  );
}
