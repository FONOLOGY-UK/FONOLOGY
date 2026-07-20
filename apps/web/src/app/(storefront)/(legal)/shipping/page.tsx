import type { Metadata } from 'next';
import { ContentPlaceholder } from '@/components/storefront/content-placeholder';

export const metadata: Metadata = { title: 'Shipping & delivery' };

export default function ShippingPage() {
  return (
    <ContentPlaceholder
      eyebrow="Help"
      title="Shipping & delivery"
      note="Delivery rates shown at checkout are provisional; the final delivery policy comes from the client."
    />
  );
}
