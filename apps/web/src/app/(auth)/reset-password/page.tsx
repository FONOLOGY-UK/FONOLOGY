import type { Metadata } from 'next';
import { ResetPasswordView } from '@/components/auth/reset-password-view';

export const metadata: Metadata = { title: 'Set a new password', robots: { index: false } };

export default function ResetPasswordPage() {
  return <ResetPasswordView />;
}
