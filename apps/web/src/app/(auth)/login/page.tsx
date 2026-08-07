import type { Metadata } from 'next';
import { LoginView } from '@/components/auth/login-view';
import { safeRedirect } from '@/lib/auth-redirect';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

/**
 * `?redirect=` is read HERE, on the server, and passed down — the house rule
 * for query params on this codebase (`useSearchParams()` suspends the client
 * component out of prerendering). It is sanitised on the way through; see
 * `lib/auth-redirect.ts` for what gets rejected and why.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;
  return <LoginView redirectTo={safeRedirect(redirect)} />;
}
