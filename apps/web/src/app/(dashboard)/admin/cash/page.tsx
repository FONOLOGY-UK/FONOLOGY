import type { Metadata } from 'next';
import { CashView } from '@/components/admin/cash/cash-view';

export const metadata: Metadata = { title: 'Cash drawer' };

/** Float & petty cash (item 7). */
export default function AdminCashPage() {
  return <CashView />;
}
