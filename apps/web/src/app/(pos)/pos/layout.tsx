import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PosShell } from '@/components/pos/pos-shell';

/** Employee POS — client-rendered app shell, explicitly not indexed. */
export const metadata: Metadata = {
  title: { default: 'Counter', template: '%s — Fonology Counter' },
  robots: { index: false, follow: false },
};

export default function PosLayout({ children }: { children: ReactNode }) {
  return <PosShell>{children}</PosShell>;
}
