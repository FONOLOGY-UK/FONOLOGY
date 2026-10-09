import { redirect } from 'next/navigation';

/** "Repair Pricing" became "Repair Types" (tester change C-3) — old links still land. */
export default function AdminRepairPricingPage() {
  redirect('/admin/repair-types');
}
