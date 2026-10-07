import type { Metadata } from 'next';
import { NotificationsView } from '@/components/admin/notifications/notifications-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Notifications' };

/** The repair-stage texts (0105), per shop with a shared default. settings.manage. */
export default function AdminNotificationsPage() {
  return (
    <RouteGuard permission="settings.manage">
      <NotificationsView />
    </RouteGuard>
  );
}
