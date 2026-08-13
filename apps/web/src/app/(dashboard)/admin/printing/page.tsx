import type { Metadata } from 'next';
import { PrintingView } from '@/components/admin/printing/printing-view';

export const metadata: Metadata = { title: 'Printers' };

/**
 * Printer health, the print queue, and the test prints.
 *
 * Guarded by `settings.manage` in the nav (admin-shell.tsx): issuing agent
 * tokens and firing test prints are owner activities, and `GET /print/agents`
 * requires that permission server-side regardless of what the nav shows.
 *
 * Note the queue ITSELF is only `requireStaff` on the API, deliberately — the
 * "did this come out?" question may need answering by whoever is on the till.
 */
export default function AdminPrintingPage() {
  return <PrintingView />;
}
