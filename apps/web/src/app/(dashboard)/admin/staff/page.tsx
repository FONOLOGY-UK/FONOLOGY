import type { Metadata } from 'next';
import { StaffView } from '@/components/admin/staff/staff-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Staff' };

/** Staff roster (item 7). */
export default function AdminStaffPage() {
  return (
    <RouteGuard permission="staff.manage">
      <StaffView />
    </RouteGuard>
  );
}
