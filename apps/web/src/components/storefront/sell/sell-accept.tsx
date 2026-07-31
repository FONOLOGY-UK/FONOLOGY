'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAcceptSellRequest } from '@/lib/data/hooks';
import { formatGBP } from '@/lib/data/types';
import { Button } from '@/components/ui/button';

/**
 * The customer's acceptance page — the far end of the one-time link staff send
 * after quoting.
 *
 * Deliberately has no sign-in: someone selling a phone may have no account,
 * and the signed token IS the proof of identity. That makes the token the whole
 * security boundary, so it is treated accordingly — it arrives in the URL, is
 * sent once to the API, and is never written to storage, a cookie, or anything
 * that outlives this page. The server stores only its SHA-256 hash, so even the
 * shop cannot recover it.
 *
 * A link that has been used, has expired, or was never valid all fail the same
 * way, with the same wording. That is partly privacy — the difference would
 * tell a stranger whether a reference exists — and partly that the distinction
 * is no help to the person reading it.
 */
export function SellAccept({ token }: { token: string | null }) {
  const accept = useAcceptSellRequest();
  const [declined, setDeclined] = useState(false);
  // React 18 dev double-invokes effects; a one-time token must not be spent
  // twice, so redemption is explicitly guarded and only ever user-initiated.
  const attempted = useRef(false);

  useEffect(() => {
    attempted.current = false;
  }, [token]);

  if (!token) {
    return (
      <Shell title="This link isn’t complete">
        <p>
          The link you followed is missing its code. Please use the full link from the message we
          sent you — copying only part of it will do this.
        </p>
        <Actions />
      </Shell>
    );
  }

  if (accept.isSuccess) {
    const request = accept.data;
    return (
      <Shell title="Thanks — that’s accepted">
        <p>
          We’ve recorded that you’re happy with our offer of{' '}
          <strong>{formatGBP(request.quotedAmount ?? 0)}</strong> for your device, against reference{' '}
          <strong>{request.reference}</strong>.
        </p>
        <p>
          Bring the device into the shop, or post it to us if that’s what you arranged. We’ll check
          it over and pay you once it arrives.
        </p>
        <p className="text-muted text-sm">
          This link has now been used and won’t work again — that’s expected.
        </p>
        <Actions />
      </Shell>
    );
  }

  if (accept.isError) {
    return (
      <Shell title="This link can’t be used">
        <p>
          It may already have been used, or it may have expired — acceptance links last seven days.
        </p>
        <p>
          Nothing has gone wrong with your trade-in. Give us a ring or reply to the message we sent
          and we’ll send a fresh link.
        </p>
        <Actions />
      </Shell>
    );
  }

  if (declined) {
    return (
      <Shell title="No problem at all">
        <p>
          We’ve not accepted anything on your behalf. If you’d rather not go ahead, you don’t need
          to do a thing — the offer will simply lapse.
        </p>
        <p>
          If you’d like us to take another look or talk about the price, get in touch and we’ll pick
          it up from there.
        </p>
        <Actions />
      </Shell>
    );
  }

  return (
    <Shell title="Accept our offer?">
      <p>
        You’re about to confirm that you’re happy with the price we quoted for your device. We’ll
        then expect it in the shop or in the post.
      </p>
      <p className="text-muted text-sm">This link works once, so only use it when you’re sure.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          disabled={accept.isPending}
          onClick={() => {
            if (attempted.current) return;
            attempted.current = true;
            accept.mutate(token);
          }}
        >
          {accept.isPending ? 'Confirming…' : 'Yes, I accept'}
        </Button>
        <Button variant="outline" disabled={accept.isPending} onClick={() => setDeclined(true)}>
          No thanks
        </Button>
      </div>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[560px] px-4 py-12 sm:px-6">
      <div className="border-line bg-card rounded-lg border p-6">
        <p className="text-muted text-[11px] font-semibold uppercase tracking-[0.08em]">
          Selling your device
        </p>
        <h1 className="font-display text-ink mt-1 text-2xl font-extrabold uppercase">{title}</h1>
        <div className="text-ink-2 mt-4 grid gap-3 text-sm leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function Actions() {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm">
        <Link href="/">Back to the shop</Link>
      </Button>
      <Button asChild variant="ghost" size="sm">
        <Link href="/contact">Contact us</Link>
      </Button>
    </div>
  );
}
