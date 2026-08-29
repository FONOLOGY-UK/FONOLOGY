import { describe, expect, it } from 'vitest';
import { safeRedirect, signInHref } from './auth-redirect';

describe('safeRedirect', () => {
  it('keeps a same-origin path', () => {
    expect(safeRedirect('/checkout')).toBe('/checkout');
    expect(safeRedirect('/shop/iphone-15-case?size=clear')).toBe('/shop/iphone-15-case?size=clear');
  });

  // Round 5 Phase 3 #22: DEFAULT_REDIRECT moved from '/' to '/account' — a
  // customer with no explicit destination now lands on their dashboard, not
  // the homepage. This test was stale from that change until Phase 4 caught
  // it running the full suite; fixed here, not a Phase 4 regression.
  it('falls back to the account dashboard when there is nothing to honour', () => {
    expect(safeRedirect(null)).toBe('/account');
    expect(safeRedirect(undefined)).toBe('/account');
    expect(safeRedirect('')).toBe('/account');
    expect(safeRedirect('   ')).toBe('/account');
  });

  it('refuses anything that leaves the site', () => {
    // The four shapes an open redirect actually arrives as.
    expect(safeRedirect('https://evil.example/pay')).toBe('/account');
    expect(safeRedirect('//evil.example/pay')).toBe('/account');
    expect(safeRedirect('/\\evil.example/pay')).toBe('/account');
    expect(safeRedirect('javascript:alert(1)')).toBe('/account');
  });

  it('refuses a bare relative path too — only rooted paths are honoured', () => {
    expect(safeRedirect('checkout')).toBe('/account');
  });
});

describe('signInHref', () => {
  it('remembers where sign-in was clicked', () => {
    expect(signInHref('/checkout')).toBe('/login?redirect=%2Fcheckout');
  });

  it('never points an auth page back at itself', () => {
    expect(signInHref('/login')).toBe('/login');
    expect(signInHref('/register')).toBe('/login');
    expect(signInHref('/staff-login')).toBe('/login');
    expect(signInHref('/auth/callback')).toBe('/login');
  });

  it('handles a missing pathname', () => {
    expect(signInHref(null)).toBe('/login');
  });
});
