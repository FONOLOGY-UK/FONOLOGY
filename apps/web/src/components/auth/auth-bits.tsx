'use client';

import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Shared pieces for the auth pages (item 9) — storefront brand language. */

export function AuthCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-card rounded-tile shadow-card border-line border p-6 sm:p-8">
      <p className="text-red text-[11px] font-bold uppercase tracking-[0.18em]">{eyebrow}</p>
      <h1 className="font-display text-ink mt-1.5 text-[28px] font-extrabold uppercase leading-[1.05] tracking-tight">
        {title}
      </h1>
      <div className="mt-6 grid gap-4">{children}</div>
    </div>
  );
}

/**
 * The one loud truth on every customer auth page: an account is OPTIONAL.
 * Browsing, buying, repairs and selling never need one.
 */
export function OptionalNotice() {
  return (
    <div className="bg-blush rounded-ui flex items-start gap-2.5 px-3.5 py-3 text-[13px] leading-snug">
      <Sparkles className="text-red-deep mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="text-ink-2">
        <strong>No account needed.</strong> Shop, book repairs, sell your phone and track it all
        with just your reference — an account only saves you typing.
      </p>
    </div>
  );
}

export function AuthDivider({ label = 'or with email' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="bg-line h-px flex-1" />
      <span className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">{label}</span>
      <span className="bg-line h-px flex-1" />
    </div>
  );
}

/** Google sign-in — mock flow behind the same adapter Raja replaces. */
export function GoogleButton({
  onClick,
  disabled,
  label = 'Continue with Google',
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-12 w-full"
      onClick={onClick}
      disabled={disabled}
    >
      <GoogleMark />
      {label}
    </Button>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.02.15 3.5 2.7.24.03c2.2-2.1 3.5-5.1 3.5-8.6"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.1 1.2a7.2 7.2 0 0 1-6.8-5l-.14.01-3.6 2.8-.05.13A12 12 0 0 0 12 24"
      />
      <path
        fill="#FBBC05"
        d="M5.2 14.4A7.4 7.4 0 0 1 4.8 12c0-.8.1-1.6.4-2.4l-.01-.16-3.7-2.8-.12.06A12 12 0 0 0 0 12c0 1.9.5 3.8 1.3 5.4z"
      />
      <path
        fill="#EB4335"
        d="M12 4.6c2.3 0 3.9 1 4.8 1.8l3.5-3.4C18.1 1.1 15.2 0 12 0A12 12 0 0 0 1.3 6.6l3.9 3C6.2 6.7 8.9 4.6 12 4.6"
      />
    </svg>
  );
}
