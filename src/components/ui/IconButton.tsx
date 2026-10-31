import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

type IconButtonVariant = 'standard' | 'tonal' | 'filled' | 'outline';

const variants: Record<IconButtonVariant, string> = {
  standard: 'text-on-surface-variant state-layer',
  tonal: 'bg-secondary-container text-on-secondary-container state-layer',
  filled: 'bg-primary text-on-primary state-layer',
  outline: 'border border-outline-variant text-on-surface-variant state-layer',
};

const base =
  'relative inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-[border-radius,background-color] duration-200 active:rounded-md focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/70 disabled:opacity-[0.38] disabled:pointer-events-none icon-slot-5';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: IconButtonVariant;
  selected?: boolean;
}

/** Botó d'icona: cercle de 40 px amb etiqueta accessible obligatòria (també com a tooltip). */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'standard', selected, className, children, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={selected}
      className={cn(
        base,
        variants[variant],
        selected && 'bg-secondary-container text-on-secondary-container rounded-md',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export default IconButton;
