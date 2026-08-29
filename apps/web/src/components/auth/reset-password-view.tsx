'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Field } from '@/components/admin/field';
import { AuthCard, AuthPasswordInput, AuthSubmit } from './auth-bits';

/**
 * Lands the Supabase password-recovery link (`resetPasswordForEmail`'s
 * `redirectTo`, built from `WEB_APP_URL` in `apps/api/src/routes/auth.routes.ts`
 * — see the comment there). Supabase's browser client picks the recovery
 * token up from the URL fragment automatically (`detectSessionInUrl: true`,
 * same mechanism `google-callback-view.tsx` uses for OAuth), which is enough
 * to call `auth.updateUser({ password })` and set a new password — no token
 * handling of our own needed.
 *
 * `getSupabaseBrowserClient()` uses `persistSession: false`, so the recovery
 * session only ever exists in memory for this one page load; there is
 * nothing to sign out of once the password is set (see the long comment on
 * that client for the full story on why signing out here would be wrong).
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

export function ResetPasswordView() {
  const router = useRouter();
  const [linkStatus, setLinkStatus] = useState<'checking' | 'valid' | 'invalid'>('checking');
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({ resolver: zodResolver(resetSchema) });

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    // detectSessionInUrl runs on client creation, but that happens on
    // module import — give it a tick, then check whether it actually found
    // a recovery session in the URL fragment. No session means the link was
    // already used, expired, or someone opened this page directly.
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setLinkStatus(data.session ? 'valid' : 'invalid');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = handleSubmit(async (values) => {
    setSubmitError(null);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      setSubmitError(error.message);
      return;
    }
    setDone(true);
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
