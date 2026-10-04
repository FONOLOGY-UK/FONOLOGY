import type { ReactNode } from 'react';

/**
 * Body for the written policy pages (privacy, terms, cookies, returns,
 * shipping). Same eyebrow/title treatment as `ContentPlaceholder`, with
 * readable section headings and prose spacing.
 */
export function LegalDocument({
  eyebrow,
  title,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  /** Human-readable "last updated" date, e.g. "4 October 2026". */
  updated: string;
  children: ReactNode;
}) {
  return (
    <article>
      <p className="text-red text-[11px] font-bold uppercase tracking-[0.18em]">{eyebrow}</p>
      <h1 className="font-display text-ink mt-2 text-4xl font-extrabold uppercase leading-none tracking-tight sm:text-5xl">
        {title}
      </h1>
      <p className="text-muted mt-3 text-xs">Last updated {updated}</p>
      <div className="text-ink-2 mt-8 space-y-4 text-sm leading-relaxed [&_a]:underline [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
    </article>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 pt-4">
      <h2 className="text-ink text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}
