'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useShopDetails } from '@/lib/data/hooks';
import { mailtoHref } from '@/lib/data/types';
import { ICO_COMPLAINTS_URL } from '@/lib/legal';

/**
 * The note shown beside a form that collects personal details (sign-up, checkout, repair booking,
 * trade-in). It says why we want the details, where the full notice is, and — as the law now asks
 * at the point of collection — that the person can complain to us, within a set time, and to the
 * ICO. It is text only: the complaint route itself is /data-protection-complaints.
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
        <Link href="/data-protection-complaints">how to complain</Link>) &mdash; and you can also
        complain to the{' '}
        <a href={ICO_COMPLAINTS_URL} target="_blank" rel="noopener noreferrer">
          Information Commissioner&rsquo;s Office
        </a>
        .
      </p>
    </div>
  );
}
