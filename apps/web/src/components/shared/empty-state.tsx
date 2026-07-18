import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared empty state — "no results", "empty bag", "no bookings yet".
 * Neutral enough for storefront and admin alike.
 */
export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'text-muted flex flex-col items-center justify-center gap-3 py-16 text-center',
        className,
      )}
    >
      {icon ? <div className="opacity-50 [&_svg]:size-7">{icon}</div> : null}
      <strong className="font-display text-ink text-xl font-extrabold uppercase">{title}</strong>
      {description ? <p className="max-w-sm text-sm">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
