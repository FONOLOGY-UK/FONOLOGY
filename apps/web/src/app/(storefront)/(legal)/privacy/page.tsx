import type { Metadata } from 'next';
import { ContentPlaceholder } from '@/components/storefront/content-placeholder';

export const metadata: Metadata = { title: 'Privacy policy' };

export default function PrivacyPage() {
  return (
    <ContentPlaceholder
      eyebrow="Legal"
      title="Privacy policy"
      note="Final privacy copy comes from the client — legal text is never invented here."
    />
  );
}
