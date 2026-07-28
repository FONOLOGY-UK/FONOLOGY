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
 * session from then on — this client's session is signed out immediately
 * after, so there is never a second, parallel, client-readable session
 * sitting around.
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
    auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: false },
  });
  return client;
}
