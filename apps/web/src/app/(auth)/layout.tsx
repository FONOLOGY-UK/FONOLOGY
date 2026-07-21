import type { ReactNode } from 'react';
import Link from 'next/link';
import '@/styles/auth.css';
import { AuthPanel, AuthTrustRow } from '@/components/auth/auth-panel';

/**
 * AUTH shell (item 9) — our design authority, in the storefront's language:
 * void black and plaster paper, Archivo display with the Instrument Serif
 * italic accent, the red used once per screen.
 *
 * A split door: the shop on the left (live reviews, the promises the
 * storefront already makes), the paperwork on the right. Below 1024px the
 * panel drops out entirely and the form stands alone — that is what keeps
 * every auth route inside one viewport with no scrolling on a small laptop.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <AuthPanel />

      <div className="auth__side">
        <Link href="/" className="auth__side-brand">
          Fonology<span>.</span>
        </Link>

        {children}

        <AuthTrustRow />

        <Link href="/" className="auth__back">
          <i aria-hidden="true">←</i> Back to the shop
        </Link>
      </div>
    </div>
  );
}
