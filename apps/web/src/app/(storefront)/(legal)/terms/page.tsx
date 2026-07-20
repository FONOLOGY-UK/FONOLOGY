import type { Metadata } from 'next';
import { ContentPlaceholder } from '@/components/storefront/content-placeholder';

export const metadata: Metadata = { title: 'Terms & conditions' };

export default function TermsPage() {
  return (
    <ContentPlaceholder
      eyebrow="Legal"
      title="Terms & conditions"
      note="Final terms come from the client — legal text is never invented here."
    />
  );
}
