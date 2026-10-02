'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useConfirmEmail } from '@/lib/data/hooks';
import { toast } from '@/lib/stores/toast.store';
import { AuthCard } from './auth-bits';

/**
 * Lands the email-confirmation link (`/auth/confirm?token=…`, sent by
 * `POST /auth/customer/signup`). Hands the token to the API, which uses it
 * up, marks the address confirmed, links any guest orders placed with it,
 * and signs the customer in.
 *
 * `useSearchParams()` needs a Suspense boundary or `next build` fails on
 * prerender; the fallback is the same "working" card, so nothing flashes.
 */
export function ConfirmEmailView() {
  return (
    <Suspense fallback={<Working />}>
      <ConfirmEmailViewInner />
    </Suspense>
  );
}

function Working() {
  return (
    <AuthCard eyebrow="One moment" title={<>Confirming your email…</>}>
      <p className="text-muted text-sm">Hang tight — verifying your address.</p>
    </AuthCard>
  );
}

function ConfirmEmailViewInner() {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const confirm = useConfirmEmail();
  const [failed, setFailed] = useState(false);
  // A link is single-use: StrictMode's second effect run must not spend it twice.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setFailed(true);
      return;
    }
    confirm.mutate(token, {
      onSuccess: () => {
        toast('Email confirmed — you’re signed in');
        router.replace('/account');
      },
      onError: () => setFailed(true),
    });
  }, [token, confirm, router]);

  if (!failed) return <Working />;
  return (
    <AuthCard eyebrow="One moment" title={<>Confirming your email…</>}>
      <div className="grid gap-3">
        <p className="text-muted text-sm">
          That link didn’t work — it may have expired or already been used. Sign in and we’ll send
          you a fresh one.
        </p>
        <a href="/login" className="btn btn--ink">
          <span className="btn__label">Back to sign in</span>
        </a>
      </div>
    </AuthCard>
  );
}
