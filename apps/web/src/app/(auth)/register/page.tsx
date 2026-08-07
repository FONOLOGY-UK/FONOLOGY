import type { Metadata } from 'next';
import { RegisterView } from '@/components/auth/register-view';
import { safeRedirect } from '@/lib/auth-redirect';

export const metadata: Metadata = { title: 'Create account', robots: { index: false } };

/** `?redirect=` carried across from /login — see the note on LoginPage. */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;
  return <RegisterView redirectTo={safeRedirect(redirect)} />;
}
