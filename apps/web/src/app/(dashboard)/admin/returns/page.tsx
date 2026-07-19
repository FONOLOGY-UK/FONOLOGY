import type { Metadata } from 'next';
import { ReturnsView } from '@/components/admin/returns/returns-view';

export const metadata: Metadata = { title: 'Returns' };

/** Returns & refunds (item 7). */
export default function AdminReturnsPage() {
  return <ReturnsView />;
}
