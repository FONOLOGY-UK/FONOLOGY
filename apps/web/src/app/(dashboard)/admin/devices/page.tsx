import type { Metadata } from 'next';
import { DevicesView } from '@/components/admin/devices/devices-view';

export const metadata: Metadata = { title: 'Device Models' };

/** Round 4 #FEAT-01 — the phone models that populate the Repair and
 * Sell-In dropdowns. Gated on inventory.manage, same as Labels — staff
 * hold it by default, so this stays unguarded (no <RouteGuard>). */
export default function AdminDevicesPage() {
  return <DevicesView />;
}
