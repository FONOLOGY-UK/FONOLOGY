import type { Metadata } from 'next';
import { ScaffoldNotice } from '@/components/shared/scaffold-notice';

export const metadata: Metadata = { title: 'Privacy policy' };

export default function PrivacyPage() {
  return (
    <ScaffoldNotice
      surface="Legal"
      title="Privacy policy"
      phase="pending — final copy from client"
    />
  );
}
