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
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
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
