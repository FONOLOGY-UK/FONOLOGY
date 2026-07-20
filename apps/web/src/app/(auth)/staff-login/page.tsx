import type { Metadata } from 'next';
import { StaffLoginView } from '@/components/auth/staff-login-view';

export const metadata: Metadata = { title: 'Staff sign-in', robots: { index: false } };

export default function StaffLoginPage() {
  return <StaffLoginView />;
}
