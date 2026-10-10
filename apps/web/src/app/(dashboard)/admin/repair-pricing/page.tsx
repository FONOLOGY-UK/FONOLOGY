import { redirect } from 'next/navigation';

/** "Repair Pricing" became "Repair Types" — old links still land. */
export default function AdminRepairPricingPage() {
  redirect('/admin/repair-types');
}
