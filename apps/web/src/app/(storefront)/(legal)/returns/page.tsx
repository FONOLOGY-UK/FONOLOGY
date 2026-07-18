import type { Metadata } from 'next';
import { ScaffoldNotice } from '@/components/shared/scaffold-notice';

export const metadata: Metadata = { title: 'Returns & warranty' };

export default function ReturnsPage() {
  return (
    <ScaffoldNotice
      surface="Legal"
      title="Returns & warranty"
      phase="pending — final copy from client"
    />
  );
}
