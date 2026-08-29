'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useGoogleSignIn, useSignIn } from '@/lib/data/hooks';
import { signInInputSchema, type SignInInput } from '@/lib/data/types';
import { Field } from '@/components/admin/field';
import {
  AuthCard,
  AuthDivider,
  AuthInput,
  AuthPasswordInput,
  AuthSubmit,
  GoogleButton,
  OptionalNotice,
} from './auth-bits';

/**
 * `redirectTo` is where sign-in lands, already sanitised by the page (see
 * `lib/auth-redirect.ts`). It exists because the checkout has always linked
 * here as `/login?redirect=/checkout` while this view pushed `/` regardless —
 * so signing in mid-checkout silently threw the customer back to the homepage.
 */
export function LoginView({ redirectTo = '/' }: { redirectTo?: string }) {
  const router = useRouter();
  const signIn = useSignIn();
  const google = useGoogleSignIn();
  const pending = signIn.isPending || google.isPending;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInInput>({ resolver: zodResolver(signInInputSchema) });

  const done = { onSuccess: () => router.push(redirectTo) };
  const submit = handleSubmit((values) => signIn.mutate(values, done));

  // Round 4 #BUG-01: NOT `google.mutate(undefined, done)` — that was the
  // bug. `done.onSuccess` used to fire the instant signInWithOAuth had
  // built the redirect URL (long before Google was ever reached), pushing
  // to `/` and racing the real browser handoff to Google — which the SPA
  // push usually won, so sign-in looked like it silently bounced back to
  // the homepage. Navigating only happens here when the adapter says
  // `redirecting: false` (mock mode's synchronous demo login); the real
  // adapter always resolves `redirecting: true`, and the real navigation
  // for it happens on /auth/callback once a session genuinely exists.
  const googleSignIn = () =>
    google.mutate(redirectTo, {
      onSuccess: (result) => {
        if (!result.redirecting) router.push(redirectTo);
      },
    });

  // Carry the destination across to /register so someone who came from the
  // checkout, realised they have no account, and signed up still lands back
  // on the checkout rather than the homepage.
  const registerHref =
    redirectTo === '/' ? '/register' : `/register?redirect=${encodeURIComponent(redirectTo)}`;

  return (
    <AuthCard eyebrow="Welcome back" title={<>Sign in.</>}>
      <OptionalNotice />
      <GoogleButton onClick={googleSignIn} disabled={pending} />
      {google.error ? (
        <p className="text-red-deep mt-2 text-sm" role="status">
          {google.error.message}
        </p>
      ) : null}
      <AuthDivider />
      <form onSubmit={submit} className="grid gap-3.5" noValidate>
        <Field label="Email" htmlFor="li-email" error={errors.email?.message}>
          <AuthInput
            id="li-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.co.uk"
            {...register('email')}
          />
        </Field>
        <Field label="Password" htmlFor="li-password" error={errors.password?.message}>
          <AuthPasswordInput
            id="li-password"
            autoComplete="current-password"
            {...register('password')}
          />
        </Field>
        {/* Round 5 #25: signIn.error was never read anywhere — a wrong
            password produced zero feedback, not even a silent no-op look;
            the button just stopped being pending. Same pattern staff-login
            already used for its own useStaffSignIn(). */}
        {signIn.isError ? (
          <p className="text-red-deep flex items-start gap-1.5 text-sm font-semibold" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {signIn.error.message}
          </p>
        ) : null}
        <AuthSubmit pending={pending} pendingLabel="Signing in…">
          Sign in
        </AuthSubmit>
      </form>
      <div className="auth-meta">
        <Link href="/forgot-password">Forgot password?</Link>
        <Link href={registerHref}>Create an account</Link>
      </div>
      {/* The staff door. Here because a team member who reaches for "sign in"
          out of habit lands on this page, and used to have no way onward
          except knowing the path. */}
      <p className="auth-staff-hint">
        Work here? <Link href="/staff-login">Staff sign-in</Link>
      </p>
    </AuthCard>
  );
}
