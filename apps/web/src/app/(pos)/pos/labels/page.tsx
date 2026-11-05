import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { LabelsView } from '@/components/admin/labels/labels-view';

export const metadata: Metadata = { title: 'Labels' };

/** On the counter, the same module as admin. */
export default function PosLabelsPage() {
  return (
    <RouteGuard permission="labels.manage">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <LabelsView />
      </div>
    </RouteGuard>
  );
}
