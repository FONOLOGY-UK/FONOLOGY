import type { Metadata } from 'next';
import { ScaffoldNotice } from '@/components/shared/scaffold-notice';

export const metadata: Metadata = { title: 'Reset password', robots: { index: false } };

export default function ForgotPasswordPage() {
  return <ScaffoldNotice surface="Auth" title="Reset password" phase="a later phase" />;
}
