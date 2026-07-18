import type { Metadata } from 'next';
import { ScaffoldNotice } from '@/components/shared/scaffold-notice';

export const metadata: Metadata = {
  title: 'Book a repair',
  description:
    'Book a same-day phone repair at Fonology. Pick your phone, the problem and your part grade — priced up front, fixed while you wait.',
};

/** Repair booking wizard — exists in the prototype; reproduced in Phase 2. */
export default function RepairPage() {
  return (
    <ScaffoldNotice surface="Storefront" title="Repair" phase="Phase 2 — storefront reproduction" />
  );
}
