import type { Metadata } from 'next';
import { ContentPlaceholder } from '@/components/storefront/content-placeholder';

export const metadata: Metadata = { title: 'FAQ' };

export default function FaqPage() {
  return (
    <ContentPlaceholder
      eyebrow="Help"
      title="Questions, answered"
      note="The real questions come from the counter — the client supplies the list worth answering."
    />
  );
}
