import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin/admin-shell';
import '@/styles/admin.css';

/** Admin dashboard — client-rendered app shell, explicitly not indexed. */
export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s — Fonology Admin' },
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
