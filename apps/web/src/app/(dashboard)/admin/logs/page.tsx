import type { Metadata } from 'next';
import { ChangeLogView } from '@/components/admin/inventory-logs/change-log-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Logs' };

/** Log B — every change to every product (0104). Owners and managers (reports.view). */
export default function AdminLogsPage() {
  return (
    <RouteGuard permission="reports.view">
      <ChangeLogView />
    </RouteGuard>
  );
}
