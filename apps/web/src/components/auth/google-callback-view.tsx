'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { apiFetch } from '@/lib/data/adapters/http.adapter';
import { queryKeys } from '@/lib/data/hooks/query-keys';
import { toast } from '@/lib/stores/toast.store';
import { safeRedirect } from '@/lib/auth-redirect';
import { AuthCard } from './auth-bits';

/**
 * Lands the Google OAuth redirect. Supabase's browser client picks up the
 * session from the URL automatically (`detectSessionInUrl: true`); this
 * page then hands those tokens to the real `POST /auth/customer/google`
 * (the API verifies them server-side and sets the same httpOnly cookie
 * every other sign-in path uses) and signs the Supabase client-side session
 * back out immediately — from that point on there is exactly one session,
 * the API's, same as email/password.
 *
 * This is the ONE place a completed Google sign-in actually navigates
 * anywhere (Round 4 #BUG-01) — login-view.tsx/register-view.tsx no longer
 * do, since resolving the redirect kickoff isn't the same as being signed
 * in. `?next=` is where the visitor was headed before they clicked
 * "Continue with Google" (set by signInWithGoogle in http.adapter.ts,
 * round-tripped through Supabase's own redirectTo); `safeRedirect` is the
 * same open-redirect guard `/login`/`/register` already apply to their own
 * `?redirect=`, since this one is just as attacker-writable.
 */
export function GoogleCallbackView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'working' | 'error'>('working');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const supabase = getSupabaseBrowserClient();
      const { data, error: sessionError } = await supabase.auth.getSession();
      const session = data.session;

      if (sessionError || !session) {
        setStatus('error');
        return;
      }

      try {
        await apiFetch('/auth/customer/google', {
          method: 'POST',
          body: JSON.stringify({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          }),
        });
        await queryClient.invalidateQueries({ queryKey: queryKeys.session });
        toast('Signed in with Google');
        router.replace(safeRedirect(searchParams.get('next')));
      } catch {
        setStatus('error');
      } finally {
        // The API's cookie is the real session now — never leave a second,
        // client-readable Supabase session sitting around.
        await supabase.auth.signOut();
      }
    })();
  }, [router, queryClient, searchParams]);

  return (
    <AuthCard eyebrow="One moment" title={<>Signing you in…</>}>
      {status === 'working' ? (
        <p className="text-muted text-sm">Hang tight — finishing up with Google.</p>
      ) : (
        <div className="grid gap-3">
          <p className="text-muted text-sm">
            That didn’t work — the Google sign-in didn’t complete. Try again, or use your email and
            password instead.
          </p>
          <a href="/login" className="btn btn--ink">
            <span className="btn__label">Back to sign in</span>
          </a>
        </div>
      )}
    </AuthCard>
  );
}
