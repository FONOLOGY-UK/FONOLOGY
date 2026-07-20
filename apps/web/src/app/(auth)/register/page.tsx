import type { Metadata } from 'next';
import { RegisterView } from '@/components/auth/register-view';

export const metadata: Metadata = { title: 'Create account', robots: { index: false } };

export default function RegisterPage() {
  return <RegisterView />;
}
