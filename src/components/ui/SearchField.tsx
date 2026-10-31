'use client';

import { Search, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

export default function SearchField({
  value,
  onChange,
  placeholder,
  label,
  clearLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  /** Nom del botó que buida el camp (per defecte, «Tanca»). */
  clearLabel?: string;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div className={cn('relative flex items-center', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 size-5 text-on-surface-variant"
      />
      <input
        type="search"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="md3-input-bare h-12 w-full rounded-full pl-10 pr-10 text-body-large md:h-10"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={clearLabel ?? t('common.clearSearch')}
          className="target-compact absolute right-1 inline-flex size-9 items-center justify-center rounded-full text-on-surface-variant state-layer"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
