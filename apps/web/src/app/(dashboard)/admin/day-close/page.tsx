import type { Metadata } from 'next';
import { DayCloseView } from '@/components/admin/cash/day-close-view';

export const metadata: Metadata = { title: 'Close the day' };

/** End-of-day cash up (Phase 2.1). Blind count, then the reconciliation. */
export default function AdminDayClosePage() {
  return <DayCloseView />;
}
