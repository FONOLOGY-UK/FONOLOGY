import { describe, expect, it } from 'vitest';
import { safeRedirect, signInHref } from './auth-redirect';

describe('safeRedirect', () => {
  it('keeps a same-origin path', () => {
    expect(safeRedirect('/checkout')).toBe('/checkout');
    expect(safeRedirect('/shop/iphone-15-case?size=clear')).toBe('/shop/iphone-15-case?size=clear');
  });

  it('falls back to the homepage when there is nothing to honour', () => {
    expect(safeRedirect(null)).toBe('/');
    expect(safeRedirect(undefined)).toBe('/');
    expect(safeRedirect('')).toBe('/');
    expect(safeRedirect('   ')).toBe('/');
  });

  it('refuses anything that leaves the site', () => {
    // The four shapes an open redirect actually arrives as.
    expect(safeRedirect('https://evil.example/pay')).toBe('/');
    expect(safeRedirect('//evil.example/pay')).toBe('/');
    expect(safeRedirect('/\\evil.example/pay')).toBe('/');
    expect(safeRedirect('javascript:alert(1)')).toBe('/');
  });

  it('refuses a bare relative path too — only rooted paths are honoured', () => {
    expect(safeRedirect('checkout')).toBe('/');
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
