import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Google sign-in: OAuth 2.0 authorisation code flow with PKCE, run entirely
 * by this API (routes in auth.routes.ts). The browser only ever navigates —
 * no Google script or token reaches the storefront.
 *
 *   /auth/google/start     → Google's consent screen
 *   /auth/google/callback  ← Google, with a one-time code
 *
 * The ID token comes straight from Google's token endpoint over TLS, in
 * exchange for our client secret, so per Google's own guidance its signature
 * needs no separate check; its issuer, audience and expiry are still checked.
 */

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export function googleRedirectUri(): string {
  return `${config.apiPublicUrl}/auth/google/callback`;
}

export interface GoogleAuthStart {
  url: string;
  /** Kept in the fnl_oauth cookie until Google sends the visitor back. */
  state: string;
  codeVerifier: string;
}

export function googleAuthStart(): GoogleAuthStart {
  if (!config.google) throw new Error('Google sign-in is not configured.');
  const state = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return { url: url.toString(), state, codeVerifier };
}

export function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface GoogleIdentity {
  /** Google's stable account id — what an account is matched on. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/** Trades the callback's code for the signed-in Google identity. Throws on anything unexpected. */
export async function googleExchange(code: string, codeVerifier: string): Promise<GoogleIdentity> {
  if (!config.google) throw new Error('Google sign-in is not configured.');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });
  if (!response.ok) throw new Error(`Google token endpoint responded ${response.status}`);
  const body = (await response.json()) as { id_token?: string };
  if (!body.id_token) throw new Error('Google returned no ID token');

  const payloadPart = body.id_token.split('.')[1];
  if (!payloadPart) throw new Error('Malformed ID token');
  const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;

  if (!ISSUERS.has(String(claims.iss))) throw new Error('ID token from an unexpected issuer');
  if (claims.aud !== config.google.clientId) throw new Error('ID token for another client');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) {
    throw new Error('ID token expired');
  }
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
    throw new Error('ID token missing sub or email');
  }
  return {
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : null,
  };
}
