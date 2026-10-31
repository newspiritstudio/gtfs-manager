import { Component, type ReactNode } from 'react';
import { NotFoundError } from '@/lib/router';
import ErrorPage from './ErrorPage';
import NotFoundPage from './NotFoundPage';

/**
 * Catches a page's failures inside the shell: `notFound()` shows the "not found" page and any
 * other error the retry page. A new address (`resetKey`) clears it.
 */
export default class PageBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { error: Error | null; key: string }
> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { error: Error | null; key: string }
  ) {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (error instanceof NotFoundError) return <NotFoundPage />;
    return <ErrorPage error={error} reset={() => this.setState({ error: null })} />;
  }
}
