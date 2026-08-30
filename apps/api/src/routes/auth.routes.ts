import { supabaseAuth, supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config.js';
import { setAuthCookies, clearAuthCookies, readCookies } from '../lib/cookies.js';
import { resolveSession } from '../lib/session.js';
import { isRateLimited, resetRateLimit } from '../lib/rateLimit.js';
import {
  signInBodySchema,
  signUpBodySchema,
  emailBodySchema,
  customerAddressBodySchema,
  addressBookInputBodySchema,
} from '../schemas.js';
import { requireCustomer } from '../middleware/auth.js';

import { createRouter } from '../lib/router.js';

export const authRouter = createRouter();

/**
 * Customer sign-up — REAL email verification (bug fix, post-"final pass"
 * report #9a; supersedes the `email_confirm: true` shortcut this endpoint
 * used before, and the comment block that used to sit here describing it).
 *
 * Uses the ANON client's ordinary `signUp()` — not `admin.createUser()` —
 * because that is the one call Supabase's own mailer is wired to: with the
 * project's "Confirm email" setting on (mailer_autoconfirm off, as this
 * project already has it — see the client-facing setup doc this bug fix
 * adds), `signUp()` sends a real confirmation email automatically and the
 * account has no session until the customer actually clicks the link.
 * `admin.createUser()` creates the row but never triggers that send, which
 * is exactly why `email_confirm: true` existed — it was papering over a
 * user who could never otherwise complete sign-up by email.
 *
 * No session is minted here. The customer lands on a "check your email"
 * screen; `POST /auth/customer/confirm-email` below is what actually signs
 * them in, once Supabase has verified the address.
 */
authRouter.post('/customer/signup', async (req, res) => {
  const parsed = signUpBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { name, email, password } = parsed.data;

  // Readiness-audit Group 2: keyed by IP alone, not IP+email — the threat
  // here is account-creation flooding (a different email on every call),
  // which an IP+email key would do nothing against. Generous window: a real
  // customer very rarely retries signup more than once or twice.
  if (isRateLimited(`customer-signup:${req.ip ?? 'unknown'}`, { max: 10, windowMs: 60 * 60_000 })) {
    return res.status(429).json({ error: 'Too many sign-up attempts. Please try again later.' });
  }

  const signUp = await supabaseAuth.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name },
      // Its own route, deliberately distinct from /auth/callback (Google's
      // redirect target) — the two land with the same shape of tokens in
      // the URL but need different endpoints on the other end (this one
      // calls confirm-email, which checks email_confirmed_at and links
      // guest orders; Google's calls /customer/google, which never would).
      emailRedirectTo: `${config.webAppUrl}/auth/confirm`,
    },
  });
  if (signUp.error || !signUp.data.user) {
    const message = signUp.error?.message ?? 'Could not create account.';
    const status = /already registered|already exists/i.test(message) ? 409 : 400;
    return res.status(status).json({ error: message });
  }

  const { error: profileError } = await supabaseAdmin
    .from('customers')
    .insert({ id: signUp.data.user.id, email, name });
  if (profileError) {
    // Roll back the auth user so a failed signup doesn't leave an orphan.
    await supabaseAdmin.auth.admin.deleteUser(signUp.data.user.id);
    return res.status(500).json({ error: 'Could not create customer profile.' });
  }

  return res.status(201).json({ email, verificationRequired: true });
});

/**
 * Completes email confirmation. Same shape as `POST /customer/google` below
 * — the browser lands on `/auth/callback` with a session Supabase's own
 * client SDK already picked up from the confirmation link's URL, hands the
 * tokens here, and this verifies them server-side and issues our own
 * httpOnly cookies. From this point the frontend never touches the
 * Supabase token again, same as every other sign-in path.
 *
 * Guest-order linking is safe here in a way it never was at signup: the
 * address is confirmed BY SUPABASE at this exact moment (`email_confirmed_at`
 * is set the instant the link is verified), not merely self-asserted — the
 * same standard the Google path already applies via `verifiedProviderEmail`.
 */
authRouter.post('/customer/confirm-email', async (req, res) => {
  const accessToken = typeof req.body?.access_token === 'string' ? req.body.access_token : null;
  const refreshToken = typeof req.body?.refresh_token === 'string' ? req.body.refresh_token : null;
  if (!accessToken || !refreshToken) {
    return res.status(400).json({ error: 'access_token and refresh_token are required.' });
  }

  const verified = await supabaseAuth.auth.getUser(accessToken);
  if (verified.error || !verified.data.user) {
    return res.status(401).json({ error: 'Invalid or expired confirmation link.' });
  }
  const user = verified.data.user;
  if (!user.email_confirmed_at) {
    return res.status(400).json({ error: 'That email address isn’t confirmed yet.' });
  }
  const email = user.email;
  if (!email) return res.status(400).json({ error: 'Account has no email.' });

  const { data: profile } = await supabaseAdmin
    .from('customers')
    .select('id, name, email')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) return res.status(404).json({ error: 'No account found for that link.' });

  const { data: linked, error: linkError } = await supabaseAdmin.rpc('link_guest_orders', {
    p_customer_id: profile.id,
    p_email: email,
  });
  if (linkError) {
    // eslint-disable-next-line no-console
    console.error('[api] guest-order link failed for', profile.id, linkError);
  } else if ((linked as number) > 0) {
    // eslint-disable-next-line no-console
    console.log(`[api] linked ${linked} guest order(s) to customer ${profile.id}`);
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

authRouter.post('/customer/signin', async (req, res) => {
  const parsed = signInBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { email, password } = parsed.data;

  // Readiness-audit Group 2: lower stakes than staff (§ /staff/signin), so
  // a looser cap — same IP+email key and record-before-outcome/reset-on-
  // success shape either way.
  const rateLimitKey = `customer-signin:${req.ip ?? 'unknown'}:${email.trim().toLowerCase()}`;
  if (isRateLimited(rateLimitKey, { max: 10, windowMs: 15 * 60_000 })) {
    return res
      .status(429)
      .json({ error: 'Too many sign-in attempts. Please try again in a few minutes.' });
  }

  const signIn = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session || !signIn.data.user) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  resetRateLimit(rateLimitKey);

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

  // Readiness-audit Group 2: TWO independent limits, because this route has
  // two different abuse shapes to close off. The IP check is the usual
  // guard against one machine hammering the endpoint. The EMAIL check is
  // the one that actually matters here and the IP check alone can't
  // provide: without it, a distributed caller rotating IPs could use this
  // endpoint as a mail bomb against one real customer's inbox — every call
  // triggers a genuine Supabase send. Deliberately checked and short-
  // circuited BEFORE calling resetPasswordForEmail, and still returns the
  // exact same 204 shape either way — see the enumeration-safety comment
  // below, which a 429 doesn't compromise (the status depends only on
  // request volume, never on whether the address is a real account).
  const email = parsed.data.email.trim().toLowerCase();
  const ipLimited = isRateLimited(`password-reset-ip:${req.ip ?? 'unknown'}`, {
    max: 5,
    windowMs: 60 * 60_000,
  });
  const emailLimited = isRateLimited(`password-reset-email:${email}`, {
    max: 3,
    windowMs: 60 * 60_000,
  });
  if (ipLimited || emailLimited) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

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

/* ---------------------------------------------------------------------- */
/* Saved address — "Save my information" at checkout (Round 5 #30)         */
/* ---------------------------------------------------------------------- */
// `customer_addresses` (0002_identity.sql) already existed, already
// structured for a full address book — this is its first write/read path.
// Signed-in customers only (requireCustomer): the checkbox that reaches
// this is hidden entirely for guests, and there is nothing to save against
// no account. One row per customer today (Phase 1) — see
// 0056_customer_addresses.sql's comment for why `city` isn't collected yet
// and why that's fine for a table designed to grow into a real address
// book later without this write path changing shape.

authRouter.get('/customer/address', requireCustomer, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('customer_addresses')
    .select('line1, postcode')
    .eq('customer_id', req.user!.id)
    .eq('is_default', true)
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'Could not load your saved address.' });
  if (!data) return res.json(null);
  return res.json({ address: data.line1, postcode: data.postcode });
});

authRouter.put('/customer/address', requireCustomer, async (req, res) => {
  const parsed = customerAddressBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { address, postcode } = parsed.data;

  // Phase 1 keeps exactly one saved address per customer — find it (if it
  // exists) and update in place, rather than the table's `customer_id`
  // allowing an unbounded insert-only accumulation of rows that never get
  // seen again. Phase 3's real address book UI is what makes "have more
  // than one" a reachable, intentional state.
  const { data: existing, error: findError } = await supabaseAdmin
    .from('customer_addresses')
    .select('id')
    .eq('customer_id', req.user!.id)
    .eq('is_default', true)
    .maybeSingle();
  if (findError) return res.status(500).json({ error: 'Could not save your address.' });

  const { error } = existing
    ? await supabaseAdmin
        .from('customer_addresses')
        .update({ line1: address, postcode })
        .eq('id', existing.id)
    : await supabaseAdmin
        .from('customer_addresses')
        .insert({ customer_id: req.user!.id, line1: address, postcode, is_default: true });
  if (error) return res.status(500).json({ error: 'Could not save your address.' });
  return res.status(204).end();
});

/* ---------------------------------------------------------------------- */
/* Address book — full CRUD (Round 5 Phase 3 #22)                          */
/* ---------------------------------------------------------------------- */
// Extends the table above, doesn't replace it: this is the same
// `customer_addresses` row Phase 1's checkout checkbox already reads/writes
// via `is_default` — set a default here and checkout's autofill picks it
// up with zero changes on that side, because it was already querying
// `is_default = true`. Every route below is self-scoped
// (`.eq('customer_id', req.user!.id)`) — there is no id-only route that
// skips the customer_id filter, so a guessed/leaked address row id from
// another account can never be read, edited or deleted through this API.

function toApiAddress(row: Record<string, unknown>) {
  return {
    id: row.id,
    label: row.label ?? null,
    address: row.line1,
    postcode: row.postcode,
    isDefault: row.is_default,
  };
}

authRouter.get('/customer/addresses', requireCustomer, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('customer_addresses')
    .select('*')
    .eq('customer_id', req.user!.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: 'Could not load your addresses.' });
  return res.json((data ?? []).map(toApiAddress));
});

authRouter.post('/customer/addresses', requireCustomer, async (req, res) => {
  const parsed = addressBookInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { label, address, postcode, isDefault } = parsed.data;

  // The customer's first address is always the default — there is no
  // sensible state where an address book has entries but no default one.
  const { count } = await supabaseAdmin
    .from('customer_addresses')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', req.user!.id);
  const makeDefault = isDefault === true || !count;

  if (makeDefault) {
    // The partial unique index (customer_addresses_one_default_idx) allows
    // only one is_default=true row per customer — clear the existing one
    // first, in the same request, so this insert never races that
    // constraint.
    await supabaseAdmin
      .from('customer_addresses')
      .update({ is_default: false })
      .eq('customer_id', req.user!.id)
      .eq('is_default', true);
  }

  const { data, error } = await supabaseAdmin
    .from('customer_addresses')
    .insert({
      customer_id: req.user!.id,
      label: label || null,
      line1: address,
      postcode,
      is_default: makeDefault,
    })
    .select('*')
    .single();
  if (error) return res.status(400).json({ error: 'Could not save that address.' });
  return res.status(201).json(toApiAddress(data));
});

authRouter.put('/customer/addresses/:id', requireCustomer, async (req, res) => {
  const parsed = addressBookInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { label, address, postcode, isDefault } = parsed.data;

  if (isDefault === true) {
    await supabaseAdmin
      .from('customer_addresses')
      .update({ is_default: false })
      .eq('customer_id', req.user!.id)
      .eq('is_default', true);
  }

  const { data, error } = await supabaseAdmin
    .from('customer_addresses')
    .update({
      label: label || null,
      line1: address,
      postcode,
      ...(isDefault === true ? { is_default: true } : {}),
    })
    // Both id AND customer_id — the id alone is not enough. This is what
    // stops one customer editing another's address by id.
    .eq('id', req.params.id)
    .eq('customer_id', req.user!.id)
    .select('*')
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'Could not save that address.' });
  if (!data) return res.status(404).json({ error: 'Address not found.' });
  return res.json(toApiAddress(data));
});

authRouter.post('/customer/addresses/:id/default', requireCustomer, async (req, res) => {
  const { data: target } = await supabaseAdmin
    .from('customer_addresses')
    .select('id')
    .eq('id', req.params.id)
    .eq('customer_id', req.user!.id)
    .maybeSingle();
  if (!target) return res.status(404).json({ error: 'Address not found.' });

  await supabaseAdmin
    .from('customer_addresses')
    .update({ is_default: false })
    .eq('customer_id', req.user!.id)
    .eq('is_default', true);
  const { error } = await supabaseAdmin
    .from('customer_addresses')
    .update({ is_default: true })
    .eq('id', target.id);
  if (error) return res.status(500).json({ error: 'Could not set that as your default.' });
  return res.status(204).end();
});

authRouter.delete('/customer/addresses/:id', requireCustomer, async (req, res) => {
  const { data: existing } = await supabaseAdmin
    .from('customer_addresses')
    .select('id, is_default')
    .eq('id', req.params.id)
    .eq('customer_id', req.user!.id)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Address not found.' });

  const { error } = await supabaseAdmin
    .from('customer_addresses')
    .delete()
    .eq('id', req.params.id)
    .eq('customer_id', req.user!.id);
  if (error) return res.status(500).json({ error: 'Could not delete that address.' });

  // Deleting the default leaves the book with no default at all, which
  // breaks checkout's autofill (it only ever looks for is_default = true) —
  // promote the next-oldest remaining address, if there is one.
  if (existing.is_default) {
    const { data: next } = await supabaseAdmin
      .from('customer_addresses')
      .select('id')
      .eq('customer_id', req.user!.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (next) {
      await supabaseAdmin.from('customer_addresses').update({ is_default: true }).eq('id', next.id);
    }
  }
  return res.status(204).end();
});
