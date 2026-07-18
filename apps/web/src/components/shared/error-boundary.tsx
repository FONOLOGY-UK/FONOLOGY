'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback; receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Generic React error boundary for wrapping widgets/sections that shouldn't
 * take the whole page down (e.g. a dashboard chart). Route-level errors are
 * handled by Next's `error.tsx` files; this is for finer-grained isolation.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback(error, this.reset);
      return <DefaultErrorFallback error={error} reset={this.reset} />;
    }
    return this.props.children;
  }
}

export function DefaultErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-tile border-line bg-card flex flex-col items-center justify-center gap-3 border p-8 text-center">
      <strong className="font-display text-ink text-lg font-extrabold uppercase">
        Something went sideways
      </strong>
      <p className="text-muted max-w-sm text-sm">
        {error.message || 'An unexpected error occurred. Try again in a moment.'}
      </p>
      <Button variant="outline" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
