'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
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
 * every other sign-in path uses) — from that point on there is exactly one
 * session, the API's, same as email/password.
 *
 * This used to also call `supabase.auth.signOut()` here in a `finally`
 * block, meaning to tidy up the client-side Supabase session. Don't add
 * that back: GoTrue's `/logout` revokes whatever session the access token
 * it's called with belongs to, and that token is the exact same one just
 * handed to `POST /auth/customer/google` and written into our own httpOnly
 * cookies — signing out here revoked our own freshly-issued session within
 * the same request, which is why Google sign-in looked like it silently did
 * nothing and looped forever. There is nothing to sign out of any more:
 * `getSupabaseBrowserClient()` now uses `persistSession: false`, so this
 * client's session only ever lived in memory for this one page and is gone
 * the moment we navigate away — see the comment there for the full story.
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
/**
 * Bug fix (pre-deploy build check): `useSearchParams()` in a page that gets
 * statically prerendered needs a Suspense boundary around it, or `next
 * build` fails outright — `pnpm build` had apparently never been run to
 * completion before now. The fallback matches the "working" state below
 * (same AuthCard shell, same copy) so there's no visible flash between the
 * prerendered fallback and the real client render.
 */
export function GoogleCallbackView() {
  return (
    <Suspense
      fallback={
        <AuthCard eyebrow="One moment" title={<>Signing you in…</>}>
          <p className="text-muted text-sm">Hang tight — finishing up with Google.</p>
        </AuthCard>
      }
    >
      <GoogleCallbackViewInner />
    </Suspense>
  );
}

function GoogleCallbackViewInner() {
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
