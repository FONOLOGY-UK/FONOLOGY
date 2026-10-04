import type { ReactNode } from 'react';

/**
 * Admin page header: eyebrow + Archivo title on the left, actions on the
 * right. Every module opens with this so the back office reads as one tool.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  actionsAlign = 'end',
}: {
  eyebrow: string;
  title: string;
  /** Usually a string; a ReactNode too so a caller can drop in a link (see submissions-view.tsx). */
  description?: ReactNode;
  actions?: ReactNode;
  /**
   * Where the actions sit against the title block. `end` (default) lines their bottoms up. A control that
   * GROWS when used — the date-range picker adds a row for Custom — must use `start`, or the controls the
   * person just clicked jump upward as the bottom edge stays put (QA v2 #1, the "laggy shift").
   */
  actionsAlign?: 'start' | 'end';
}) {
  return (
    <header
      className={`mb-6 flex flex-wrap justify-between gap-4 ${actionsAlign === 'start' ? 'items-start' : 'items-end'}`}
    >
      <div>
        <p className="text-red text-[11px] font-bold uppercase tracking-[0.18em]">{eyebrow}</p>
        <h1 className="font-display text-ink mt-1 text-[26px] font-extrabold uppercase leading-none tracking-tight">
          {title}
        </h1>
        {description ? <p className="text-muted mt-2 max-w-xl text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
