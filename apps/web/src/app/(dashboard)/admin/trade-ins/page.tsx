import type { Metadata } from 'next';
import { TradeInsView } from '@/components/admin/tradeins/tradeins-view';

export const metadata: Metadata = { title: 'Trade-ins' };

/** Devices bought in from customers — payouts deducted from revenue. */
export default function AdminTradeInsPage() {
  return <TradeInsView />;
}
