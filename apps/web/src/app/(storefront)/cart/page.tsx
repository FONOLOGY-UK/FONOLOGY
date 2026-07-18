import type { Metadata } from 'next';
import { ScaffoldNotice } from '@/components/shared/scaffold-notice';

export const metadata: Metadata = {
  title: 'Your bag',
};

/** Cart page — the prototype uses a slide-out drawer; a full page mirrors it. */
export default function CartPage() {
  return (
    <ScaffoldNotice
      surface="Storefront"
      title="Your bag"
      phase="Phase 2 — storefront reproduction"
    />
  );
}
