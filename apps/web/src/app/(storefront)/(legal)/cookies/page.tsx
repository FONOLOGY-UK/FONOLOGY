import type { Metadata } from 'next';
import { ContentPlaceholder } from '@/components/storefront/content-placeholder';

export const metadata: Metadata = { title: 'Cookies' };

export default function CookiesPage() {
  return (
    <ContentPlaceholder
      eyebrow="Legal"
      title="Cookie policy"
      note="Cookie copy depends on the final analytics/marketing stack — the client confirms both."
    />
  );
}
