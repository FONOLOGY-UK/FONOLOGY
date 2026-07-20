import type { Metadata } from 'next';
import { ForgotView } from '@/components/auth/forgot-view';

export const metadata: Metadata = { title: 'Reset password', robots: { index: false } };

export default function ForgotPasswordPage() {
  return <ForgotView />;
}
