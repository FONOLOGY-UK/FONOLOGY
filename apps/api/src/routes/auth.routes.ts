import { Router } from 'express';
import { supabaseAuth, supabaseAdmin } from '../lib/supabase.js';
import { setAuthCookies, clearAuthCookies, readCookies } from '../lib/cookies.js';
import { resolveSession } from '../lib/session.js';
import { signInBodySchema, signUpBodySchema, emailBodySchema } from '../schemas.js';

export const authRouter = Router();

/**
 * Customer sign-up. Uses the ADMIN client (service role) to create the
 * auth.users row with email_confirm: true — deterministic, not dependent on
 * outbound email deliverability — then creates the `customers` profile row,
 * then signs in with the ANON client (using the password the caller just
 * supplied) to mint a genuine session. Both steps run against
 * SUPABASE_URL from config — the dev project, per this phase's hard rule.
 */
authRouter.post('/customer/signup', async (req, res) => {
  const parsed = signUpBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { name, email, password } = parsed.data;

  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    const message = created.error?.message ?? 'Could not create account.';
    const status = /already been registered|already exists/i.test(message) ? 409 : 400;
    return res.status(status).json({ error: message });
  }

  const { error: profileError } = await supabaseAdmin
    .from('customers')
    .insert({ id: created.data.user.id, email, name });
  if (profileError) {
    // Roll back the auth user so a failed signup doesn't leave an orphan.
    await supabaseAdmin.auth.admin.deleteUser(created.data.user.id);
    return res.status(500).json({ error: 'Could not create customer profile.' });
  }

  const signIn = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session) {
    return res.status(500).json({ error: 'Account created, but sign-in failed. Try signing in.' });
  }

  setAuthCookies(res, signIn.data.session.access_token, signIn.data.session.refresh_token);
  return res.status(201).json({
    id: created.data.user.id,
    name,
    email,
    kind: 'customer',
    staffRole: null,
    permissions: null,
  });
});

authRouter.post('/customer/signin', async (req, res) => {
  const parsed = signInBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { email, password } = parsed.data;

  const signIn = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session || !signIn.data.user) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  setAuthCookies(res, signIn.data.session.access_token, signIn.data.session.refresh_token);

  const { data: profile } = await supabaseAdmin
    .from('customers')
    .select('id, name, email')
    .eq('id', signIn.data.user.id)
    .maybeSingle();

  if (!profile) return res.status(500).json({ error: 'No customer profile for this account.' });

  return res.json({
    id: profile.id,
    name: profile.name,
    email: profile.email,
    kind: 'customer',
    staffRole: null,
    permissions: null,
  });
});

/**
 * Google sign-in. Supabase's own recommended pattern: the BROWSER performs
 * the OAuth redirect directly against Supabase Auth (identity bootstrapping
 * via the Auth SDK is explicitly what the anon key is for — this is not the
 * "frontend reaches Supabase for business data" case the ground rules
 * forbid). The frontend then hands the resulting access token to this
 * endpoint, which verifies it, creates the `customers` profile row on first
 * sign-in, and issues our own httpOnly session cookies exactly like every
 * other sign-in path — from this point on, the frontend never touches the
 * Supabase token again.
 */
authRouter.post('/customer/google', async (req, res) => {
  const accessToken = typeof req.body?.access_token === 'string' ? req.body.access_token : null;
  const refreshToken = typeof req.body?.refresh_token === 'string' ? req.body.refresh_token : null;
  if (!accessToken || !refreshToken) {
    return res.status(400).json({ error: 'access_token and refresh_token are required.' });
  }

  const verified = await supabaseAuth.auth.getUser(accessToken);
  if (verified.error || !verified.data.user) {
    return res.status(401).json({ error: 'Invalid Google session.' });
  }
  const user = verified.data.user;
  const email = user.email;
  if (!email) return res.status(400).json({ error: 'Google account has no email.' });

  const { data: existing } = await supabaseAdmin
    .from('customers')
    .select('id, name, email')
    .eq('id', user.id)
    .maybeSingle();

  const profile =
    existing ??
    (
      await supabaseAdmin
        .from('customers')
        .insert({
          id: user.id,
          email,
          name:
            (user.user_metadata?.full_name as string | undefined) ??
            email.split('@')[0] ??
            'Customer',
        })
        .select('id, name, email')
        .single()
    ).data;

  if (!profile) return res.status(500).json({ error: 'Could not create customer profile.' });

  setAuthCookies(res, accessToken, refreshToken);
  return res.json({
    id: profile.id,
    name: profile.name,
    email: profile.email,
    kind: 'customer',
    staffRole: null,
    permissions: null,
  });
});

authRouter.get('/session', async (req, res) => {
  const user = await resolveSession(req, res);
  return res.json(user);
});

authRouter.post('/signout', async (req, res) => {
  const { accessToken } = readCookies(req);
  if (accessToken) {
    // Best-effort — revokes the token server-side (admin.signOut needs the
    // service-role client, not the anon one). Cookie clearing below is what
    // actually ends the session from this app's perspective either way.
    await supabaseAdmin.auth.admin.signOut(accessToken).catch(() => undefined);
  }
  clearAuthCookies(res);
  return res.status(204).end();
});

authRouter.post('/password-reset', async (req, res) => {
  const parsed = emailBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  // Always report success regardless of whether the email exists — do not
  // let this endpoint be used to enumerate accounts.
  await supabaseAuth.auth.resetPasswordForEmail(parsed.data.email).catch(() => undefined);
  return res.status(204).end();
});
