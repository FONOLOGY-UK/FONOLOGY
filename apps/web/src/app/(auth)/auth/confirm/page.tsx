import type { Metadata } from 'next';
import { ConfirmEmailView } from '@/components/auth/confirm-email-view';

export const metadata: Metadata = { title: 'Confirming your email…', robots: { index: false } };

export default function ConfirmEmailPage() {
  return <ConfirmEmailView />;
}
