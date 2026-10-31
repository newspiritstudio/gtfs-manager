import type { ReactNode } from 'react';
import type { EngineState } from '@/lib/engine';
import { notFound } from '@/lib/router';

/**
 * A page's data: the skeleton while it loads, the page once it is there. A failure goes up to
 * the error boundary and missing data (null) shows the "not found" page.
 */
export default function Loaded<T>({
  state,
  skeleton,
  children,
}: {
  state: EngineState<T>;
  skeleton: ReactNode;
  children: (data: NonNullable<T>) => ReactNode;
}) {
  if (state.status === 'loading') return <>{skeleton}</>;
  if (state.status === 'error') throw state.error;
  if (state.data === null || state.data === undefined) notFound();
  return <>{children(state.data as NonNullable<T>)}</>;
}
