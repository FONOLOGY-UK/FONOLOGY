'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Form field wrapper for admin surfaces: label above, control, error below.
 * Keeps every admin form identical in rhythm without repeating markup.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="text-ink text-[11px] font-semibold uppercase tracking-[0.08em]"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-red-deep text-xs font-medium">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
