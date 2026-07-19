import type { Metadata } from 'next';
import { StaffView } from '@/components/admin/staff/staff-view';

export const metadata: Metadata = { title: 'Staff' };

/** Staff roster (item 7). */
export default function AdminStaffPage() {
  return <StaffView />;
}
