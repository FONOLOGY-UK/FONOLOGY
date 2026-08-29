import { supabaseAuth, supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config.js';
import { setAuthCookies, clearAuthCookies, readCookies } from '../lib/cookies.js';
import { resolveSession } from '../lib/session.js';
import { signInBodySchema, signUpBodySchema, emailBodySchema } from '../schemas.js';

import { createRouter } from '../lib/router.js';

export const authRouter = createRouter();

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

  // NO guest-order linking here, on purpose.
  //
  // `email_confirm: true` above marks the address confirmed without anyone
  // proving they own it, so at this point `email` is self-asserted. Adopting
  // guest orders on it would let someone register with a stranger's address and
  // inherit their order history, delivery addresses and purchases. The project
  // itself does require confirmation (mailer_autoconfirm is off) — this
  // endpoint is what bypasses it.
  //
  // To enable linking here: drop `email_confirm: true`, add a real
  // confirm-your-email step, and only then call `link_guest_orders` once the
  // address is actually confirmed. Until that exists this must stay unlinked.
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
 * Did a third-party provider actually verify this email address?
 *
 * This is the gate on adopting guest orders, so it checks the identity rather
 * than trusting `email_confirmed_at`. That column is useless for the purpose:
 * `admin.createUser({ email_confirm: true })` — which our own password signup
 * uses — sets it without anybody having proved anything, so a self-asserted
 * address and a Google-verified one look identical there.
 *
 * What is trustworthy is an identity from a non-email provider carrying
 * `email_verified`, which is the provider's own assertion about an address it
 * controls.
 */
function verifiedProviderEmail(
  user: { identities?: unknown; email?: string | null },
  email: string,
): boolean {
  const identities = (user.identities ?? []) as {
    provider?: string;
    identity_data?: Record<string, unknown>;
  }[];
  return identities.some((identity) => {
    if (!identity.provider || identity.provider === 'email') return false;
    const data = identity.identity_data ?? {};
    const identityEmail = typeof data.email === 'string' ? data.email : null;
    if (!identityEmail || identityEmail.toLowerCase() !== email.toLowerCase()) return false;
    return data.email_verified === true || data.email_verified === 'true';
  });
}

/**
 * Which third-party sign-in providers are actually usable right now.
 *
 * The Google button exists in the UI but the provider is not configured yet
 * (Kashir adds the OAuth credentials later). Without this check, clicking it
 * redirected the customer to Supabase's own `/authorize`, which answers with
 * raw JSON — `{"code":400,...,"msg":"Unsupported provider: provider is not
 * enabled"}` — unstyled, on a Supabase domain, with no way back to the shop.
 * That is worse than having no button.
 *
 * Read live from Supabase's public `/auth/v1/settings` rather than a flag in
 * our own config, so the day the credentials are added the button simply starts
 * working with no code change and no redeploy.
 */
authRouter.get('/providers', async (_req, res) => {
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: config.supabaseAnonKey },
    });
    if (!response.ok) throw new Error(`settings responded ${response.status}`);
    const settings = (await response.json()) as { external?: Record<string, boolean> };
    return res.json({ google: settings.external?.google === true });
  } catch {
    // If we cannot tell, say not available. Claiming a provider works and
    // then dumping the customer on an error page is the failure being fixed.
    return res.json({ google: false });
  }
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

  // Adopt any guest orders placed with this address (client decision 5).
  //
  // Done HERE and not on password signup, deliberately. The rule is that the
  // email must have been verified by the auth provider — otherwise registering
  // with a stranger's address would inherit their order history, addresses and
  // purchases. On this path Google has verified it, and `verifyProviderEmail`
  // below confirms that from the identity rather than assuming it.
  //
  // Only run on FIRST sign-in (`!existing`): re-running on every sign-in would
  // be wasted work, and a returning customer has nothing new to adopt.
  if (!existing && verifiedProviderEmail(user, email)) {
    const { data: linked, error: linkError } = await supabaseAdmin.rpc('link_guest_orders', {
      p_customer_id: profile.id,
      p_email: email,
    });
    if (linkError) {
      // Never fail the sign-in over this — the customer is in, they just don't
      // see old guest orders yet. Logged loudly enough to chase.
      // eslint-disable-next-line no-console
      console.error('[api] guest-order link failed for', profile.id, linkError);
    } else if ((linked as number) > 0) {
      // eslint-disable-next-line no-console
      console.log(`[api] linked ${linked} guest order(s) to customer ${profile.id}`);
    }
  }

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
  // redirectTo is built from WEB_APP_URL (config.ts, env-driven — see
  // ENV-SETUP-GUIDE.md) rather than hardcoded, so this lands on the right
  // origin in every environment. Supabase appends its own recovery token to
  // this URL; the page there (`/reset-password`) reads it via
  // detectSessionInUrl and lets the visitor set a new password.
  await supabaseAuth.auth
    .resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${config.webAppUrl}/reset-password`,
    })
    .catch(() => undefined);
  return res.status(204).end();
});
