'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, MailCheck } from 'lucide-react';
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

function loginHrefFor(redirectTo: string): string {
  return redirectTo === '/' ? '/login' : `/login?redirect=${encodeURIComponent(redirectTo)}`;
}

/** `redirectTo` is sanitised by the page — see the note on LoginView. */
export function RegisterView({ redirectTo = '/' }: { redirectTo?: string }) {
  const router = useRouter();
  const signUp = useSignUp();
  const google = useGoogleSignIn();
  const pending = signUp.isPending || google.isPending;
  // Bug fix (post-"final pass" report #9a): a real confirmation email means
  // there's no session to redirect into any more — this holds the address
  // just long enough to tell the customer where the email went.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpInput>({ resolver: zodResolver(signUpInputSchema) });

  const done = {
    onSuccess: (result: { email: string; verificationRequired: boolean }) => {
      if (result.verificationRequired) setAwaitingConfirmation(result.email);
      else router.push(redirectTo);
    },
  };
  const submit = handleSubmit((values) => signUp.mutate(values, done));

  if (awaitingConfirmation) {
    return (
      <AuthCard eyebrow="Almost there" title={<>Check your email.</>}>
        <div className="grid gap-3">
          <p className="text-ink flex items-start gap-2 text-sm">
            <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            We’ve sent a confirmation link to <strong>{awaitingConfirmation}</strong>. Click it to
            finish creating your account and sign in.
          </p>
          <p className="text-muted text-xs">
            Didn’t get it? Check spam, or{' '}
            <Link href={loginHrefFor(redirectTo)}>try signing in</Link> once you’ve confirmed.
          </p>
        </div>
      </AuthCard>
    );
  }

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

  const loginHref = loginHrefFor(redirectTo);

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
            {signUp.error?.message}
          </p>
        ) : null}
        {/* Bug fix (post-"final pass" report #9a): real verification now —
            see auth.routes.ts's /customer/signup and /customer/confirm-email. */}
        <p className="text-muted -mt-1 text-xs">
          We’ll email you a link to confirm your address before you can sign in.
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
