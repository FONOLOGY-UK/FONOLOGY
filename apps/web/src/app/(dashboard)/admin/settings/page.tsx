import type { Metadata } from 'next';
import { SettingsView } from '@/components/admin/settings/settings-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Settings' };

/** Shop settings + screen-lock PIN (item 7). */
export default function AdminSettingsPage() {
  return (
    <RouteGuard permission="settings.manage">
      <SettingsView />
    </RouteGuard>
  );
}
