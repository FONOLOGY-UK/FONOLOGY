import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageLoading } from '@/components/admin/page-loading';
import { SalesView } from '@/components/admin/sales/sales-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Counter Sales' };

/** In-person POS sales, filterable by date, staff and payment type (FEATURE-13). */
export default function AdminSalesPage() {
  return (
    <RouteGuard permission="payments.view">
      <Suspense fallback={<PageLoading />}>
        <SalesView />
      </Suspense>
    </RouteGuard>
  );
}
