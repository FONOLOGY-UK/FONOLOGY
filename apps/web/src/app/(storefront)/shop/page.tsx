import type { Metadata } from 'next';
import { ScaffoldNotice } from '@/components/shared/scaffold-notice';

export const metadata: Metadata = {
  title: 'Shop',
  description:
    'Cases, chargers, cables and audio — every product tested at the Fonology repair bench before it earns shelf space.',
};

/** Shop catalogue — exists in the prototype; reproduced in Phase 2. */
export default function ShopPage() {
  return (
    <ScaffoldNotice surface="Storefront" title="Shop" phase="Phase 2 — storefront reproduction" />
  );
}
