import type { Metadata } from 'next';
import { RepairTypesView } from '@/components/admin/repair-types/repair-types-view';

export const metadata: Metadata = { title: 'Repair Types' };

/** Repair types and sub-types — definitions only (, 0109). Gated on
 * inventory.manage server-side, same as Device Models. */
export default function AdminRepairTypesPage() {
  return <RepairTypesView />;
}
