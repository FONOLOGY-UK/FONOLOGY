'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCompletePasswordReset, usePasswordResetCheck } from '@/lib/data/hooks';
import { Field } from '@/components/admin/field';
import { AuthCard, AuthPasswordInput, AuthSubmit } from './auth-bits';

/**
 * Lands the password-reset link (`/reset-password?token=…`, emailed by
 * `POST /auth/password-reset`). Asks the API whether the token is still good
 * before showing the form, then sends it back with the new password. The
 * token is single-use and expires after an hour; setting the password signs
 * the account out everywhere, so the visitor signs in again with it.
 */
const resetSchema = z
  .object({
    password: z.string().min(8, 'At least 8 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords don't match",
    path: ['confirm'],
  });
type ResetValues = z.infer<typeof resetSchema>;

/** `useSearchParams()` needs a Suspense boundary or `next build` fails on prerender. */
export function ResetPasswordView() {
  return (
    <Suspense
      fallback={
        <AuthCard eyebrow="Almost done" title={<>Set a new password.</>}>
          <p className="text-muted -mt-1 text-sm">Checking your link…</p>
        </AuthCard>
      }
    >
      <ResetPasswordViewInner />
    </Suspense>
  );
}

function ResetPasswordViewInner() {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const check = usePasswordResetCheck(token);
  const complete = useCompletePasswordReset();
  const linkStatus: 'checking' | 'valid' | 'invalid' = !token
    ? 'invalid'
    : check.isPending
      ? 'checking'
      : check.data
        ? 'valid'
        : 'invalid';
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({ resolver: zodResolver(resetSchema) });

  const submit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await complete.mutateAsync({ token: token!, password: values.password });
      setDone(true);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not update your password.');
    }
  });

  if (done) {
    return (
      <AuthCard eyebrow="All set" title={<>Password updated.</>}>
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="text-success mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-ink-2 text-sm leading-relaxed">
            Your password has been changed. Sign in with your new password to continue.
          </p>
        </div>
        <button type="button" className="btn btn--ink" onClick={() => router.replace('/login')}>
          <span className="btn__label">Back to sign in</span>
        </button>
      </AuthCard>
    );
  }

  if (linkStatus === 'invalid') {
    return (
      <AuthCard eyebrow="Link expired" title={<>That link didn’t work.</>}>
        <p className="text-muted text-sm">
          Password reset links only work once and expire after a while. Request a fresh one.
        </p>
        <Link href="/forgot-password" className="btn btn--ink">
          <span className="btn__label">Send a new link</span>
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard eyebrow="Almost done" title={<>Set a new password.</>}>
      {linkStatus === 'checking' ? (
        <p className="text-muted -mt-1 text-sm">Checking your link…</p>
      ) : (
        <>
          <p className="text-muted -mt-1 text-sm">Choose a new password for your account.</p>
          <form onSubmit={submit} className="grid gap-3.5" noValidate>
            <Field label="New password" htmlFor="rp-password" error={errors.password?.message}>
              <AuthPasswordInput
                id="rp-password"
                autoComplete="new-password"
                {...register('password')}
              />
            </Field>
            <Field label="Confirm password" htmlFor="rp-confirm" error={errors.confirm?.message}>
              <AuthPasswordInput
                id="rp-confirm"
                autoComplete="new-password"
                {...register('confirm')}
              />
            </Field>
            {submitError ? (
              <p className="text-red-deep text-sm font-semibold" role="alert">
                {submitError}
              </p>
            ) : null}
            <AuthSubmit pending={isSubmitting} pendingLabel="Updating…">
              Update password
            </AuthSubmit>
          </form>
        </>
      )}
    </AuthCard>
  );
}
