import type { Metadata } from 'next';
import { ContentPlaceholder } from '@/components/storefront/content-placeholder';
import { RETURN_WINDOW_DAYS } from '@/lib/config';

export const metadata: Metadata = { title: 'Returns & warranty' };

export default function ReturnsPolicyPage() {
  return (
    <ContentPlaceholder
      eyebrow="Legal"
      title="Returns & warranty"
      note={`The shop operates a ${RETURN_WINDOW_DAYS}-day returns window; the full policy wording comes from the client.`}
    />
  );
}
