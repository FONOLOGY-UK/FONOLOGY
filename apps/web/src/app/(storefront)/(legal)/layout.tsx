import type { ReactNode } from 'react';

/**
 * Legal pages shell (privacy, terms, returns…). Placeholders for now — final
 * copy comes from the client. Constrained reading measure.
 * NOTE (HARD RULE #3): no VAT number appears here or anywhere in the footer.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16 pt-[calc(var(--nav-h)+2rem)]">
      {children}
    </div>
  );
}
