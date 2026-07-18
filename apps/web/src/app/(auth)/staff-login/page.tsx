import type { Metadata } from 'next';
import { ScaffoldNotice } from '@/components/shared/scaffold-notice';

export const metadata: Metadata = { title: 'Staff sign-in', robots: { index: false } };

export default function StaffLoginPage() {
  return <ScaffoldNotice surface="Auth" title="Staff sign-in" phase="a later phase" />;
}
