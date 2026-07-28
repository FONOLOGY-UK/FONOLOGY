import type { Response } from 'express';
import { config } from '../config.js';

/**
 * Session transport: httpOnly, Secure (in production), SameSite=Lax cookies.
 * Never readable from client-side JS — this is what makes "reload can't
 * bypass a locked till" actually true; there is no client-side token to
 * fake, only a cookie the browser attaches automatically and the server
 * verifies against Supabase Auth on every request.
 */

const ACCESS_COOKIE = 'fnl_session';
const REFRESH_COOKIE = 'fnl_refresh';
const STAFF_SESSION_COOKIE = 'fnl_staff_session';

const baseCookieOpts = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'lax' as const,
  path: '/',
};

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseCookieOpts, maxAge: 60 * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...baseCookieOpts, maxAge: 30 * 24 * 60 * 60 * 1000 });
}

export function setStaffSessionCookie(res: Response, staffSessionId: string): void {
  res.cookie(STAFF_SESSION_COOKIE, staffSessionId, {
    ...baseCookieOpts,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, baseCookieOpts);
  res.clearCookie(REFRESH_COOKIE, baseCookieOpts);
  res.clearCookie(STAFF_SESSION_COOKIE, baseCookieOpts);
}

export function readCookies(req: { cookies?: Record<string, string> }): {
  accessToken: string | null;
  refreshToken: string | null;
  staffSessionId: string | null;
} {
  const cookies = req.cookies ?? {};
  return {
    accessToken: cookies[ACCESS_COOKIE] ?? null,
    refreshToken: cookies[REFRESH_COOKIE] ?? null,
    staffSessionId: cookies[STAFF_SESSION_COOKIE] ?? null,
  };
}
