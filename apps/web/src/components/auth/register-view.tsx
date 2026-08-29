'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useGoogleSignIn, useSignUp } from '@/lib/data/hooks';
import { signUpInputSchema, type SignUpInput } from '@/lib/data/types';
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

/** `redirectTo` is sanitised by the page — see the note on LoginView. */
export function RegisterView({ redirectTo = '/' }: { redirectTo?: string }) {
  const router = useRouter();
  const signUp = useSignUp();
  const google = useGoogleSignIn();
  const pending = signUp.isPending || google.isPending;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpInput>({ resolver: zodResolver(signUpInputSchema) });

  const done = { onSuccess: () => router.push(redirectTo) };
  const submit = handleSubmit((values) => signUp.mutate(values, done));

  // Round 4 #BUG-01 — see the identical comment on LoginView. Not
  // `google.mutate(undefined, done)`: navigating here only when the
  // adapter says `redirecting: false` is what stops a kicked-off OAuth
  // redirect from being treated as a completed sign-in.
  const googleSignIn = () =>
    google.mutate(redirectTo, {
      onSuccess: (result) => {
        if (!result.redirecting) router.push(redirectTo);
      },
    });

  const loginHref =
    redirectTo === '/' ? '/login' : `/login?redirect=${encodeURIComponent(redirectTo)}`;

  return (
    <AuthCard eyebrow="New here" title={<>Create an account.</>}>
      <OptionalNotice />
      <GoogleButton onClick={googleSignIn} disabled={pending} label="Sign up with Google" />
      {google.error ? (
        <p className="text-red-deep mt-2 text-sm" role="status">
          {google.error.message}
        </p>
      ) : null}
      <AuthDivider />
      <form onSubmit={submit} className="grid gap-3.5" noValidate>
        <Field label="Name" htmlFor="re-name" error={errors.name?.message}>
          <AuthInput
            id="re-name"
            autoComplete="name"
            placeholder="Your name"
            {...register('name')}
          />
        </Field>
        <Field label="Email" htmlFor="re-email" error={errors.email?.message}>
          <AuthInput
            id="re-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.co.uk"
            {...register('email')}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="re-password"
          error={errors.password?.message}
          hint="At least 8 characters"
        >
          <AuthPasswordInput
            id="re-password"
            autoComplete="new-password"
            {...register('password')}
          />
        </Field>
        {/* Round 5 #24: signUp.error was never read — a duplicate email
            (409) produced zero feedback. Same pattern as login-view.tsx's
            #25 fix / staff-login's own useStaffSignIn() error display. The
            signup password itself was already confirmed working end to end
            — this only adds the missing failure message. */}
        {signUp.isError ? (
          <p className="text-red-deep flex items-start gap-1.5 text-sm font-semibold" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {signUp.error.message}
          </p>
        ) : null}
        {/* Bug fix (client report: "account creation sends no verification
            email"). Investigated: this is deliberate, not a gap — the
            signup endpoint (apps/api's /customer/signup) auto-confirms the
            address server-side and signs the customer in immediately,
            precisely so there's no dependency on outbound email
            deliverability (see that endpoint's own header comment). That's
            a legitimate choice for a shop this size, but it was silent —
            nothing told the person what to expect, which is what actually
            read as broken. This just says the quiet part out loud. */}
        <p className="text-muted -mt-1 text-xs">
          No confirmation email — you’ll be signed in straight away.
        </p>
        <AuthSubmit pending={pending} pendingLabel="Creating…">
          Create account
        </AuthSubmit>
      </form>
      <p className="auth-meta auth-meta--center">
        <span>
          Already got one? <Link href={loginHref}>Sign in</Link>
        </span>
      </p>
    </AuthCard>
  );
}
