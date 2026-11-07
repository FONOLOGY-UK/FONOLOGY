'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useShopDetails } from '@/lib/data/hooks';
import { mailtoHref } from '@/lib/data/types';

/**
 * The note shown beside a form that collects personal details (sign-up, checkout, repair booking,
 * trade-in). It says why we want the details, where the full notice is, and that the person can
 * complain to us, within a set time. The right to complain to the ICO is on /privacy and
 * /data-protection-complaints, not here. It is text only.
 */
export function DataNotice({ purpose, children }: { purpose: string; children?: ReactNode }) {
  const { data: shop } = useShopDetails();
  const email = shop?.shopEmail ?? null;
  return (
    <div className="legal-note">
      <p>
        We use these details only to {purpose}. Our <Link href="/privacy">privacy notice</Link>{' '}
        explains what we keep, for how long, and your rights.
      </p>
      {children}
      <p>
        If you&rsquo;re unhappy with how we handle your data, you can complain to us
        {email ? (
          <>
            {' '}
            at <a href={mailtoHref(email)}>{email}</a>
          </>
        ) : null}{' '}
        &mdash; we&rsquo;ll acknowledge it within 30 days (see{' '}
        <Link href="/data-protection-complaints">how to complain</Link>).
      </p>
    </div>
  );
}
