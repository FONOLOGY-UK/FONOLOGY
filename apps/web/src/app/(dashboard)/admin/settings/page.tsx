import type { Metadata } from 'next';
import { SettingsView } from '@/components/admin/settings/settings-view';

export const metadata: Metadata = { title: 'Settings' };

/** Shop settings + screen-lock PIN (item 7). */
export default function AdminSettingsPage() {
  return <SettingsView />;
}
