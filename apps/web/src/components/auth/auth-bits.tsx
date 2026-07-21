'use client';

import * as React from 'react';
import { Eye, EyeOff, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spark } from '@/components/storefront/art';
import { cn } from '@/lib/utils';

/**
 * Shared pieces for the auth pages (item 9). All styling lives in
 * `styles/auth.css` — these components only assemble it, so every auth route
 * keeps the same rhythm and there is one place to tune it.
 */

export function AuthCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="auth-card auth-rise auth-rise--2">
      <p className="auth-card__eyebrow">
        <Spark variant="red" />
        {eyebrow}
      </p>
      <h1 className="auth-card__title">{title}</h1>
      <div className="auth-card__body">{children}</div>
    </section>
  );
}

/**
 * The one loud truth on every customer auth page: an account is OPTIONAL.
 * Browsing, buying, repairs and selling never need one.
 */
export function OptionalNotice() {
  return (
    <p className="auth-optional">
      <Sparkles className="size-4" aria-hidden="true" />
      <span>
        <strong>No account needed.</strong> Shop, book repairs, sell your phone and track it all
        with just your reference — an account only saves you typing.
      </span>
    </p>
  );
}

export function AuthDivider({ label = 'or with email' }: { label?: string }) {
  return (
    <div className="auth-divider" aria-hidden="true">
      <span>{label}</span>
    </div>
  );
}

/** Text input shared by every auth form (see `.auth-input` in auth.css). */
export const AuthInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <Input ref={ref} className={cn('auth-input', className)} {...props} />
));
AuthInput.displayName = 'AuthInput';

/**
 * Password input with a show/hide toggle — the cheapest fix there is for a
 * mistyped password on a form this short.
 */
export const AuthPasswordInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => {
  const [shown, setShown] = React.useState(false);
  return (
    <div className="auth-password">
      <AuthInput ref={ref} type={shown ? 'text' : 'password'} className={className} {...props} />
      <button
        type="button"
        className="auth-password__toggle"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
      >
        {shown ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
});
AuthPasswordInput.displayName = 'AuthPasswordInput';

/** Primary action — the storefront's arrow, without its slide-up fill. */
export function AuthSubmit({
  children,
  pending,
  pendingLabel,
}: {
  children: React.ReactNode;
  pending?: boolean;
  pendingLabel: string;
}) {
  return (
    <Button type="submit" className="auth-submit" disabled={pending}>
      {pending ? (
        pendingLabel
      ) : (
        <>
          {children}
          <span className="auth-submit__arrow" aria-hidden="true">
            →
          </span>
        </>
      )}
    </Button>
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
      className="auth-google"
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
