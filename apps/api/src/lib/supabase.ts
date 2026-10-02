import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

/**
 * Supabase Storage only — the last thing this service still uses Supabase
 * for (product images, ID documents, buy-in forms). Tables go through
 * lib/db.ts and sign-in through lib/authSessions.ts. Service-role key, so
 * server-side only.
 */
export const supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
