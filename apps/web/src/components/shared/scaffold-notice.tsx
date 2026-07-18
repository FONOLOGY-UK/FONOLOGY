import type { ReactNode } from 'react';

/**
 * Phase-1 route shell marker. Every route in the architecture exists and
 * renders, but pages whose full build belongs to a later phase render this
 * honest placeholder rather than a half-built (or invented) design. Storefront
 * pages are reproduced from the prototype in Phase 2; admin/employee in later
 * phases. See NOTES.md for the phase map.
 */
export function ScaffoldNotice({
  surface,
  title,
  phase,
  children,
}: {
  surface: string;
  title: string;
  phase: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[40vh] max-w-2xl flex-col items-start gap-3 px-6 py-16">
      <span className="border-line text-muted inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
        <span className="bg-red size-2 rounded-full" aria-hidden />
        {surface} · scaffold
      </span>
      <h1 className="font-display text-3xl font-extrabold uppercase tracking-tight">{title}</h1>
      <p className="text-muted text-sm">
        Route is wired and ready. Full build lands in <strong className="text-ink">{phase}</strong>.
      </p>
      {children ? <div className="w-full pt-2">{children}</div> : null}
    </div>
  );
}
