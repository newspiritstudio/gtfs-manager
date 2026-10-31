import Link from 'next/link';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import Spinner from './Spinner';

/** Les cinc variants MD3 de botó de l'Àgora: un sol primari per pantalla. */
export type ButtonVariant = 'primary' | 'tonal' | 'outline' | 'ghost' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex shrink-0 min-w-11 md:min-w-10 max-w-full items-center justify-center gap-2 text-center transition-[border-radius,background-color,border-color,color] duration-200 ease-[cubic-bezier(0.34,0.8,0.34,1)] motion-reduce:transition-colors text-label-large leading-tight whitespace-nowrap focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/70 focus-visible:ring-offset-2 min-h-11 md:min-h-10 disabled:pointer-events-none';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary state-layer border-0',
  tonal: 'bg-secondary-container text-on-secondary-container state-layer border-0',
  outline: 'border border-outline text-on-surface state-layer bg-transparent',
  ghost: 'text-on-surface state-layer bg-transparent border border-transparent',
  destructive: 'bg-error text-on-error state-layer border-0',
};

const disabledVariants: Record<ButtonVariant, string> = {
  primary: 'bg-on-surface/[0.12] text-on-surface/[0.38] border-0',
  tonal: 'bg-on-surface/[0.12] text-on-surface/[0.38] border-0',
  destructive: 'bg-on-surface/[0.12] text-on-surface/[0.38] border-0',
  outline: 'border border-on-surface/[0.12] text-on-surface/[0.38] bg-transparent',
  ghost: 'text-on-surface/[0.38] bg-transparent border border-transparent',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-label-medium md:min-h-8 rounded-xl active:rounded-sm icon-slot-4',
  md: 'px-4 md:px-5 py-2 rounded-xl active:rounded-sm icon-slot-4',
  lg: 'px-6 md:px-7 py-3 md:min-h-11 rounded-xl active:rounded-lg icon-slot-5',
};

function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  disabled = false
) {
  return cn(base, disabled ? disabledVariants[variant] : variants[variant], sizes[size]);
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    className,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      className={cn(
        buttonClasses(variant, size, Boolean(disabled)),
        loading && 'pointer-events-none',
        className
      )}
      {...props}
      onClick={loading ? undefined : props.onClick}
    >
      {loading ? (
        <>
          <Spinner />
          <span className="sr-only">{children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
});

export default Button;

export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const external = /^https?:/.test(href) || href.startsWith('/api/');
  if (external) {
    return (
      <a href={href} className={cn(buttonClasses(variant, size), className)} {...props}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cn(buttonClasses(variant, size), className)} {...props}>
      {children}
    </Link>
  );
}
