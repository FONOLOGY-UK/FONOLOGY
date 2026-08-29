import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { StaffSettingsView } from '@/components/pos/staff-settings-view';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Round 5 Phase 2 #4 — every signed-in staff member's own PIN and
 * auto-lock, regardless of what else they can do. Gated on `pos.operate`
 * (the most baseline permission there is — anyone who can touch the till
 * holds it) rather than left ungated, so a session that somehow isn't
 * staff at all still can't reach it; not gated on anything narrower, since
 * this is about an account managing itself, not a shop-wide capability.
 */
export default function PosSettingsPage() {
  return (
    <RouteGuard permission="pos.operate">
      <StaffSettingsView />
    </RouteGuard>
  );
}
