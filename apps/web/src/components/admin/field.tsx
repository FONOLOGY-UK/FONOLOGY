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

/**
 * Mock upload control — file inputs are UI-only until Raja wires storage.
 * Shows the chosen filename; stores the name, never the bytes.
 */
export function UploadField({
  id,
  value,
  onChange,
  accept,
  emptyLabel = 'Choose a file…',
}: {
  id: string;
  value: string | null;
  onChange: (filename: string | null) => void;
  accept?: string;
  emptyLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={id}
        className="border-input rounded-ui bg-card text-foreground hover:bg-secondary inline-flex h-10 cursor-pointer items-center gap-2 border px-3 text-sm transition-colors"
      >
        <span className="bg-paper-2 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase">
          Upload
        </span>
        <span className={cn('max-w-[180px] truncate', !value && 'text-muted/70')}>
          {value ?? emptyLabel}
        </span>
      </label>
      <input
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => onChange(e.target.files?.[0]?.name ?? null)}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-muted hover:text-red-deep text-xs underline underline-offset-2"
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}
