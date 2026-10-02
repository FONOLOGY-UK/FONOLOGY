'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/data/hooks/query-keys';
import { toast } from '@/lib/stores/toast.store';
import { safeRedirect } from '@/lib/auth-redirect';
import { AuthCard } from './auth-bits';

/**
 * Where the API's Google sign-in ends (`/auth/google/callback` redirects
 * here). By then the work is done: either the session cookie is already set,
 * or `?error=` says why not. This page only refreshes the session and moves
 * on.
 *
 * This is the ONE place a completed Google sign-in navigates anywhere (Round 4
 * #BUG-01) — login-view.tsx/register-view.tsx don't, since kicking off the
 * redirect isn't the same as being signed in. `?next=` is where the visitor
 * was headed before they clicked "Continue with Google"; `safeRedirect` is the
 * same open-redirect guard `/login` and `/register` apply to `?redirect=`.
 *
 * `useSearchParams()` needs a Suspense boundary or `next build` fails on
 * prerender; the fallback is the same "working" card.
 */
export function GoogleCallbackView() {
  return (
    <Suspense fallback={<Working />}>
      <GoogleCallbackViewInner />
    </Suspense>
  );
}

function Working() {
  return (
    <AuthCard eyebrow="One moment" title={<>Signing you in…</>}>
      <p className="text-muted text-sm">Hang tight — finishing up with Google.</p>
    </AuthCard>
  );
}

const ERRORS: Record<string, string> = {
  staff: 'Staff accounts sign in with their email and password on the staff sign-in page.',
  unverified: 'Your Google account’s email address isn’t verified, so we can’t use it to sign in.',
  unavailable: 'Google sign-in isn’t available yet — please use your email address.',
};

function GoogleCallbackViewInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const error = searchParams.get('error');
  const ran = useRef(false);

  useEffect(() => {
    if (error || ran.current) return;
    ran.current = true;
    void (async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      toast('Signed in with Google');
      router.replace(safeRedirect(searchParams.get('next')));
    })();
  }, [error, router, queryClient, searchParams]);

  if (!error) return <Working />;
  return (
    <AuthCard eyebrow="One moment" title={<>Signing you in…</>}>
      <div className="grid gap-3">
        <p className="text-muted text-sm">
          {ERRORS[error] ??
            'That didn’t work — the Google sign-in didn’t complete. Try again, or use your email and password instead.'}
        </p>
        <a href={error === 'staff' ? '/staff-login' : '/login'} className="btn btn--ink">
          <span className="btn__label">Back to sign in</span>
        </a>
      </div>
    </AuthCard>
  );
}
