'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { apiFetch } from '@/lib/data/adapters/http.adapter';
import { queryKeys } from '@/lib/data/hooks/query-keys';
import { toast } from '@/lib/stores/toast.store';
import { AuthCard } from './auth-bits';

/**
 * Lands the email-confirmation link (bug fix, post-"final pass" report
 * #9a). Same pattern as google-callback-view.tsx, on its own route
 * (`/auth/confirm`, not `/auth/callback`) because it hands the tokens to a
 * different API endpoint — `POST /auth/customer/confirm-email`, which
 * checks the address is actually confirmed and links any guest orders
 * placed on it, neither of which the Google endpoint does.
 */
export function ConfirmEmailView() {
  const router = useRouter();
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
        await apiFetch('/auth/customer/confirm-email', {
          method: 'POST',
          body: JSON.stringify({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          }),
        });
        await queryClient.invalidateQueries({ queryKey: queryKeys.session });
        toast('Email confirmed — you’re signed in');
        router.replace('/account');
      } catch {
        setStatus('error');
      }
    })();
  }, [router, queryClient]);

  return (
    <AuthCard eyebrow="One moment" title={<>Confirming your email…</>}>
      {status === 'working' ? (
        <p className="text-muted text-sm">Hang tight — verifying your address.</p>
      ) : (
        <div className="grid gap-3">
          <p className="text-muted text-sm">
            That link didn’t work — it may have expired. Request a fresh one by signing in, or
            create your account again.
          </p>
          <a href="/login" className="btn btn--ink">
            <span className="btn__label">Back to sign in</span>
          </a>
        </div>
      )}
    </AuthCard>
  );
}
