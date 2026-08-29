import type { Metadata } from 'next';
import { RepairTypesView } from '@/components/admin/repair-types/repair-types-view';

export const metadata: Metadata = { title: 'Repair Pricing' };

/** Round 5 #33 (admin half) — the repair problems and part-quality prices
 * that populate /repair. Gated on inventory.manage, same as Device Models —
 * staff hold it by default, so this stays unguarded (no <RouteGuard>). */
export default function AdminRepairPricingPage() {
  return <RepairTypesView />;
}
