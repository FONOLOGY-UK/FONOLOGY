import type { Metadata } from 'next';
import { ScaffoldNotice } from '@/components/shared/scaffold-notice';

export const metadata: Metadata = { title: 'Terms & conditions' };

export default function TermsPage() {
  return (
    <ScaffoldNotice
      surface="Legal"
      title="Terms & conditions"
      phase="pending — final copy from client"
    />
  );
}
