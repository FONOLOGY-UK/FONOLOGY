import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@/styles/admin.css';
import { PosShell } from '@/components/pos/pos-shell';

/**
 * Employee POS — client-rendered app shell, explicitly not indexed.
 *
 * `admin.css` is imported here as well as in the admin layout because the
 * till REUSES the admin components wholesale — the jobs board, inventory,
 * cash drawer and trade-ins screens under /pos are literally the components
 * from `components/admin/`. Without this import they render on the counter
 * with none of their own styles.
 *
 * Found because "Print device label" from /pos/jobs produced a six-page PDF
 * of the whole jobs board: the `@media print` rules that reduce the page to
 * just `.print-area` live in this stylesheet, so on the POS routes there
 * were no print rules at all and `window.print()` printed everything. The
 * POS receipt (`components/pos/receipt.tsx`) uses the same `.print-area`
 * mechanism and was broken the same way.
 */
export const metadata: Metadata = {
  title: { default: 'Counter', template: '%s | Fonology Counter' },
  robots: { index: false, follow: false },
};

export default function PosLayout({ children }: { children: ReactNode }) {
  return <PosShell>{children}</PosShell>;
}
