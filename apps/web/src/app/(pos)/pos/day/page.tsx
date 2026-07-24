import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { DayView } from '@/components/pos/day-view';

export const metadata: Metadata = { title: 'My day' };

/**
 * The employee's own shift figures — today only. Guarded by `sales.today`,
 * the narrowest sales permission in the map.
 */
export default function PosDayPage() {
  return (
    <RouteGuard permission="sales.today">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <DayView />
      </div>
    </RouteGuard>
  );
}
