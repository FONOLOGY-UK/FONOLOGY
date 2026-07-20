import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * AUTH shell (item 9) — our design authority, in the storefront's language:
 * plaster paper, Archivo display, the red used sparingly. A quiet utility
 * surface with one loud truth: accounts are OPTIONAL.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-paper text-ink relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-12">
      {/* Faint oversized brand mark — the wall behind the counter. */}
      <p
        aria-hidden="true"
        className="font-display text-ink/[0.04] pointer-events-none absolute -bottom-10 left-1/2 -translate-x-1/2 select-none whitespace-nowrap text-[22vw] font-extrabold uppercase leading-none tracking-tight"
      >
        Fonology
      </p>

      <div className="relative w-full max-w-md">
        <Link
          href="/"
          className="font-display text-ink mb-8 block text-center text-2xl font-extrabold uppercase tracking-tight"
        >
          Fonology<span className="text-red">.</span>
        </Link>
        {children}
        <p className="text-muted mt-8 text-center text-xs">
          <Link href="/" className="hover:text-red underline underline-offset-2 transition-colors">
            ← Back to the shop
          </Link>
        </p>
      </div>
    </div>
  );
}
