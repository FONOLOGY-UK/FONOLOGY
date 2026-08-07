import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { ScannerDiagnosticView } from '@/components/pos/scanner-diagnostic-view';

export const metadata: Metadata = { title: 'Scanner diagnostic' };

/**
 * Not linked from any nav — reached by URL only. A two-minute job for
 * whoever has the real Eyoyo EY-7130 in hand: open this page, scan once,
 * read off the report. See scanner-diagnostic-view.tsx for why this exists
 * as its own standalone capture rather than reusing the till's scan logic.
 *
 * Gated by `inventory.manage`, the same permission every barcode-scanning
 * screen already requires — no new access grant.
 */
export default function ScannerTestPage() {
  return (
    <RouteGuard permission="inventory.manage">
      <ScannerDiagnosticView />
    </RouteGuard>
  );
}
