import type { Metadata } from 'next';
import { BarcodeRegisterView } from '@/components/admin/inventory-logs/barcode-register-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Barcode register' };

/** Barcodes registered through Goods in on the tills (0123). Owners (reports.view). */
export default function AdminBarcodeRegisterPage() {
  return (
    <RouteGuard permission="reports.view">
      <BarcodeRegisterView />
    </RouteGuard>
  );
}
