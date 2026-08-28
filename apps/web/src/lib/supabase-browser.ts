import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser-only Supabase client — exists for exactly one thing: the Google
 * OAuth redirect handshake (`signInWithOAuth` on the login/register pages,
 * `getSession()` on `/auth/callback`). It never touches business data —
 * that's the API's job, through `http.adapter.ts`. Uses the PUBLIC anon
 * key (RLS-protected, meant to ship in the browser bundle), not the
 * service-role key, which never leaves `apps/api`.
 *
 * Once the callback page has handed the Supabase session's tokens to
 * `POST /auth/customer/google`, the API's own httpOnly cookie is the real
 * session from then on.
 *
 * `persistSession: false` is load-bearing, not a style choice — this used
 * to be `true`, with `google-callback-view.tsx` calling
 * `supabase.auth.signOut()` in a `finally` block afterward to avoid leaving
 * a second, client-readable session sitting in localStorage. That signOut()
 * call is exactly what broke Google sign-in end to end: GoTrue's `/logout`
 * revokes the session belonging to whatever access token it's called with —
 * scope ('global' vs 'local') only controls whether *other* sessions are
 * also revoked, the current one always is — and the current one was the
 * SAME access/refresh token pair just handed to `POST /auth/customer/google`
 * and written into our own httpOnly cookies moments earlier. Every
 * subsequent request re-validates that cookie against Supabase
 * (`resolveSession` in apps/api/src/lib/session.ts calls
 * `supabaseAuth.auth.getUser(accessToken)` on every request, falling back to
 * the refresh token), so the moment `signOut()` ran, our own freshly-issued
 * session started failing that check — the user landed back on the site
 * already signed out, with no error and no way to tell why. Confirmed via a
 * raw curl against Supabase's REST auth API: `getUser` with a token succeeds
 * (200), `POST /logout` on that same token succeeds (204), and the very next
 * `getUser` call with the identical token then fails with `403
 * session_not_found` — for both `scope=global` and `scope=local`.
 *
 * With `persistSession: false`, `detectSessionInUrl` still resolves the
 * session from the URL fragment into this client's IN-MEMORY storage (so
 * `getSession()` on the callback page still works exactly as before) — it's
 * only ever written to real `localStorage` when `persistSession: true`. That
 * in-memory copy is gone the moment this module's JS context goes away (next
 * navigation, reload), so there is nothing to explicitly sign out of, and
 * nothing to revoke.
 */
let client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Google sign-in needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY set in apps/web/.env.local.',
    );
  }

  client = createClient(url, anonKey, {
    auth: { persistSession: false, detectSessionInUrl: true, autoRefreshToken: false },
  });
  return client;
}
