import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

/**
 * Two clients, two purposes — never mixed:
 *
 *  - `supabaseAuth` (anon key): public Auth operations performed *on behalf
 *    of* a not-yet-authenticated caller — signUp/signInWithPassword/
 *    resetPasswordForEmail/getUser(token). This is exactly what the anon key
 *    is for; RLS still applies to anything it touches (and RLS denies
 *    everything in `public` by design — see 0011_security.sql).
 *
 *  - `supabaseAdmin` (service role key): every business-table query, and
 *    Auth admin operations (admin.createUser, with immediate email
 *    confirmation so account creation doesn't depend on outbound email
 *    deliverability). Bypasses RLS entirely — this is the ONLY client that
 *    should ever touch `customers`, `staff`, `staff_permissions`,
 *    `staff_sessions`, `reference_registry`, or any other table. Every
 *    permission decision on top of it is enforced in this app's own code
 *    (mirroring `staff_can()`), not by RLS.
 */

export const supabaseAuth = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
