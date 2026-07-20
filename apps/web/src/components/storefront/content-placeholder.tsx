import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';

/**
 * Placeholder page body (item 10). Correct route, title and layout — with an
 * unmissable "content to be finalised" block instead of invented copy. Every
 * page using this is listed in CONTENT-TODO.md. No legal copy is written by
 * us (HARD RULE #5: ask, don't invent).
 */
export function ContentPlaceholder({
  eyebrow,
  title,
  note,
  children,
}: {
  eyebrow: string;
  title: string;
  /** One line about who supplies the final content. */
  note: string;
  /** Optional real, already-confirmed fragments (e.g. contact details). */
  children?: ReactNode;
}) {
  return (
    <article>
      <p className="text-red text-[11px] font-bold uppercase tracking-[0.18em]">{eyebrow}</p>
      <h1 className="font-display text-ink mt-2 text-4xl font-extrabold uppercase leading-none tracking-tight sm:text-5xl">
        {title}
      </h1>

      {children ? <div className="mt-8">{children}</div> : null}

      <div className="border-line-strong bg-card rounded-tile mt-8 border border-dashed p-6">
        <p className="text-ink flex items-center gap-2 text-sm font-bold uppercase tracking-[0.08em]">
          <FileText className="text-red size-4" aria-hidden="true" />
          Content to be finalised
        </p>
        <p className="text-muted mt-2 text-sm leading-relaxed">
          This page is routed and styled, but the words aren’t ours to write. {note} See
          CONTENT-TODO.md for the full list of pages awaiting content.
        </p>
      </div>
    </article>
  );
}
