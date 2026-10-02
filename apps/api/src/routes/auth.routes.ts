import { attempt, db, rpc, sql } from '../lib/db.js';
import { isUuid } from '../lib/uuid.js';
import { config } from '../config.js';
import {
  clearAuthCookies,
  readCookies,
  setOAuthCookie,
  setSessionCookie,
  takeOAuthCookie,
} from '../lib/cookies.js';
import { resolveSession, type ApiAuthUser } from '../lib/session.js';
import { isRateLimited, resetRateLimit } from '../lib/rateLimit.js';
import { clientIp } from '../lib/clientIp.js';
import { hashPassword } from '../lib/password.js';
import { checkAccountPassword, findAccountByEmail, normaliseEmail } from '../lib/accounts.js';
import {
  consumeOneTimeToken,
  createAuthSession,
  createOneTimeToken,
  peekOneTimeToken,
  revokeAllAuthSessions,
  revokeAuthSession,
} from '../lib/authSessions.js';
import { sendConfirmEmail, sendPasswordResetEmail } from '../lib/authEmails.js';
import { googleAuthStart, googleExchange, sameState, type GoogleIdentity } from '../lib/google.js';
import {
  signInBodySchema,
  signUpBodySchema,
  emailBodySchema,
  tokenBodySchema,
  passwordResetCompleteBodySchema,
  customerAddressBodySchema,
  addressBookInputBodySchema,
} from '../schemas.js';
import { requireCustomer } from '../middleware/auth.js';

import { createRouter } from '../lib/router.js';

export const authRouter = createRouter();

/** A customer's `AuthUser` — same shape as resolveSession's customer branch. */
function customerAuthUser(profile: { id: string; name: string; email: string }): ApiAuthUser {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    kind: 'customer',
    staffRole: null,
    permissions: null,
  };
}

/**
 * Adopts guest orders placed with this address (client decision 5). Only ever
 * called once the address is PROVEN — a clicked confirmation link, or Google
 * vouching for it — never on a self-asserted signup, or registering with a
 * stranger's address would inherit their order history. Never fails the
 * sign-in: the customer is in either way, they just don't see old guest
 * orders yet.
 */
async function adoptGuestOrders(customerId: string, email: string): Promise<void> {
  const { data: linked, error } = await attempt(() =>
    rpc<number>('link_guest_orders', { p_customer_id: customerId, p_email: email }),
  );
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[api] guest-order link failed for', customerId, error);
  } else if (linked > 0) {
    // eslint-disable-next-line no-console
    console.log(`[api] linked ${linked} guest order(s) to customer ${customerId}`);
  }
}

const ACCOUNT_EXISTS = 'An account with that email already exists. Sign in instead.';

/**
 * Customer sign-up, with real email verification: the account is created
 * unconfirmed, a single-use link is emailed, and there is no session until
 * that link is used (`POST /customer/confirm-email`). The customer lands on a
 * "check your email" screen meanwhile.
 *
 * Signing up again with an address still waiting for confirmation re-sends
 * the link and changes nothing else — in particular not the password, or
 * anyone could re-register an address they don't own before its owner
 * confirms.
 */
authRouter.post('/customer/signup', async (req, res) => {
  const parsed = signUpBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { name, password } = parsed.data;
  const email = normaliseEmail(parsed.data.email);

  // Readiness-audit Group 2: keyed by IP alone, not IP+email — the threat
  // here is account-creation flooding (a different email on every call),
  // which an IP+email key would do nothing against. Generous window: a real
  // customer very rarely retries signup more than once or twice.
  if (
    isRateLimited(`customer-signup:${clientIp(req) ?? 'unknown'}`, {
      max: 10,
      windowMs: 60 * 60_000,
    })
  ) {
    return res.status(429).json({ error: 'Too many sign-up attempts. Please try again later.' });
  }

  const existing = await db
    .selectFrom('user_accounts')
    .leftJoin('customers', 'customers.id', 'user_accounts.id')
    .select(['user_accounts.id', 'user_accounts.email_verified_at', 'customers.name'])
    .where('user_accounts.email', '=', email)
    .executeTakeFirst();
  if (existing) {
    if (existing.email_verified_at || existing.name === null) {
      return res.status(409).json({ error: ACCOUNT_EXISTS });
    }
    const token = await createOneTimeToken(existing.id, 'email_confirm');
    await sendConfirmEmail({ email, name: existing.name }, token);
    return res.status(201).json({ email, verificationRequired: true });
  }

  const passwordHash = await hashPassword(password);
  const { data: accountId, error } = await attempt(() =>
    db.transaction().execute(async (trx) => {
      const account = await trx
        .insertInto('user_accounts')
        .values({ email, password_hash: passwordHash })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('customers').values({ id: account.id, email, name }).execute();
      return account.id;
    }),
  );
  if (error) {
    // Two signups for one address racing: the unique index decides.
    if (error.code === '23505') return res.status(409).json({ error: ACCOUNT_EXISTS });
    return res.status(500).json({ error: 'Could not create customer profile.' });
  }

  const token = await createOneTimeToken(accountId, 'email_confirm');
  await sendConfirmEmail({ email, name }, token);
  return res.status(201).json({ email, verificationRequired: true });
});

/**
 * The confirmation link (`/auth/confirm?token=…` on the storefront) lands
 * here: the token is used up, the address marked verified, guest orders
 * placed with it adopted, and the customer signed in.
 */
authRouter.post('/customer/confirm-email', async (req, res) => {
  const parsed = tokenBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A token is required.' });

  const accountId = await consumeOneTimeToken(parsed.data.token, 'email_confirm');
  if (!accountId) return res.status(401).json({ error: 'Invalid or expired confirmation link.' });

  const account = await db
    .updateTable('user_accounts')
    .set({ email_verified_at: sql`coalesce(email_verified_at, now())` })
    .where('id', '=', accountId)
    .returning('email')
    .executeTakeFirstOrThrow();

  const profile = await db
    .selectFrom('customers')
    .select(['id', 'name', 'email'])
    .where('id', '=', accountId)
    .executeTakeFirst();
  if (!profile) return res.status(404).json({ error: 'No account found for that link.' });

  await adoptGuestOrders(profile.id, account.email);

  setSessionCookie(req, res, await createAuthSession(accountId, req.get('user-agent')));
  return res.json(customerAuthUser(profile));
});

authRouter.post('/customer/signin', async (req, res) => {
  const parsed = signInBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { email, password } = parsed.data;

  // Readiness-audit Group 2: lower stakes than staff (§ /staff/signin), so
  // a looser cap — same IP+email key and record-before-outcome/reset-on-
  // success shape either way.
  const rateLimitKey = `customer-signin:${clientIp(req) ?? 'unknown'}:${normaliseEmail(email)}`;
  if (isRateLimited(rateLimitKey, { max: 10, windowMs: 15 * 60_000 })) {
    return res
      .status(429)
      .json({ error: 'Too many sign-in attempts. Please try again in a few minutes.' });
  }

  const account = await findAccountByEmail(email);
  // Checked even when no account matched, so both cost the same time.
  const passwordOk = await checkAccountPassword(account, password);
  if (!account || !passwordOk) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  resetRateLimit(rateLimitKey);

  const profile = await db
    .selectFrom('customers')
    .select(['id', 'name', 'email'])
    .where('id', '=', account.id)
    .executeTakeFirst();
  if (!profile) return res.status(403).json({ error: 'No customer account for that email.' });

  // Only reachable with the right password, so it tells nobody anything new.
  if (!account.email_verified_at) {
    const token = await createOneTimeToken(account.id, 'email_confirm');
    await sendConfirmEmail({ email: profile.email, name: profile.name }, token);
    return res.status(403).json({
      error: 'Please confirm your email address first — we’ve sent you a new link.',
    });
  }

  setSessionCookie(req, res, await createAuthSession(account.id, req.get('user-agent')));
  return res.json(customerAuthUser(profile));
});

/**
 * Which third-party sign-in providers are usable. The storefront asks before
 * sending anyone to Google, so a missing OAuth client is a sentence on the
 * sign-in page rather than an error page on Google's.
 */
authRouter.get('/providers', (_req, res) => {
  return res.json({ google: config.google !== null });
});

/** Only a same-site path survives the round trip — never `//host` or a full URL. */
function safeNext(value: unknown): string | null {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value.slice(0, 500) : null;
}

/**
 * Google sign-in, step 1: the storefront navigates here (a full page load,
 * not a fetch) and is sent on to Google's consent screen. `state` and the
 * PKCE verifier wait in a short-lived cookie for step 2.
 */
authRouter.get('/google/start', (req, res) => {
  if (!config.google) {
    return res.redirect(303, `${config.webAppUrl}/auth/callback?error=unavailable`);
  }
  const start = googleAuthStart();
  setOAuthCookie(
    res,
    JSON.stringify({
      state: start.state,
      verifier: start.codeVerifier,
      next: safeNext(req.query.next),
    }),
  );
  return res.redirect(303, start.url);
});

type GoogleOutcome = { kind: 'staff' } | { kind: 'customer'; accountId: string; adopt: boolean };

/**
 * Finds or creates the account a Google identity signs in to, in one
 * transaction. Matched on Google's stable `sub` first; failing that, on the
 * address Google has verified, which links Google to the existing account.
 *
 * Linking to an account whose address was never confirmed also clears its
 * password: whoever set it never proved they own the address, and leaving it
 * would let them sign in to the account its real owner just claimed.
 */
async function googleSignInAccount(identity: GoogleIdentity): Promise<GoogleOutcome> {
  return db.transaction().execute(async (trx) => {
    let accountId: string;
    let newlyVerified = false;

    const bySub = await trx
      .selectFrom('user_accounts')
      .select('id')
      .where('google_sub', '=', identity.sub)
      .executeTakeFirst();
    if (bySub) {
      accountId = bySub.id;
    } else {
      const byEmail = await trx
        .selectFrom('user_accounts')
        .select(['id', 'email_verified_at'])
        .where('email', '=', identity.email)
        .forUpdate()
        .executeTakeFirst();
      if (byEmail) {
        accountId = byEmail.id;
        newlyVerified = byEmail.email_verified_at === null;
        await trx
          .updateTable('user_accounts')
          .set({
            google_sub: identity.sub,
            email_verified_at: sql`coalesce(email_verified_at, now())`,
            ...(newlyVerified ? { password_hash: null } : {}),
          })
          .where('id', '=', accountId)
          .execute();
        if (newlyVerified) await revokeAllAuthSessions(accountId, trx);
      } else {
        const created = await trx
          .insertInto('user_accounts')
          .values({
            email: identity.email,
            google_sub: identity.sub,
            email_verified_at: sql`now()`,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        accountId = created.id;
        newlyVerified = true;
      }
    }

    // Staff sign in with a password on the staff page, where the till's
    // session rules live. A Google session for a staff account would have no
    // staff session behind it and resolve to nobody.
    const staff = await trx
      .selectFrom('staff')
      .select('id')
      .where('id', '=', accountId)
      .executeTakeFirst();
    if (staff) return { kind: 'staff' };

    const customer = await trx
      .selectFrom('customers')
      .select('id')
      .where('id', '=', accountId)
      .executeTakeFirst();
    if (!customer) {
      await trx
        .insertInto('customers')
        .values({
          id: accountId,
          email: identity.email,
          name: identity.name ?? identity.email.split('@')[0] ?? 'Customer',
        })
        .execute();
    }
    return { kind: 'customer', accountId, adopt: !customer || newlyVerified };
  });
}

/**
 * Google sign-in, step 2: Google sends the visitor back here with a one-time
 * code. On success the session cookie is set and the visitor is sent to the
 * storefront's `/auth/callback`, which only refreshes the session and moves
 * on to `next`. Every failure lands there too, as `?error=…`.
 */
authRouter.get('/google/callback', async (req, res) => {
  const back = (params: Record<string, string>) =>
    res.redirect(
      303,
      `${config.webAppUrl}/auth/callback?${new URLSearchParams(params).toString()}`,
    );

  const saved = (() => {
    try {
      const raw = takeOAuthCookie(req, res);
      return raw
        ? (JSON.parse(raw) as { state: string; verifier: string; next: string | null })
        : null;
    } catch {
      return null;
    }
  })();
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;
  if (!saved || !code || !state || !sameState(state, saved.state)) return back({ error: 'failed' });

  let identity: GoogleIdentity;
  try {
    identity = await googleExchange(code, saved.verifier);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[auth] Google exchange failed:', err instanceof Error ? err.message : err);
    return back({ error: 'failed' });
  }
  if (!identity.emailVerified) return back({ error: 'unverified' });

  const { data: outcome, error } = await attempt(() => googleSignInAccount(identity));
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[auth] Google sign-in account step failed:', error);
    return back({ error: 'failed' });
  }
  if (outcome.kind === 'staff') return back({ error: 'staff' });

  if (outcome.adopt) await adoptGuestOrders(outcome.accountId, identity.email);
  setSessionCookie(req, res, await createAuthSession(outcome.accountId, req.get('user-agent')));
  return back(saved.next ? { next: saved.next } : {});
});

authRouter.get('/session', async (req, res) => {
  const user = await resolveSession(req, res);
  return res.json(user);
});

authRouter.post('/signout', async (req, res) => {
  await revokeAuthSession(readCookies(req).sessionToken).catch(() => undefined);
  clearAuthCookies(req, res);
  return res.status(204).end();
});

authRouter.post('/password-reset', (req, res) => {
  const parsed = emailBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  // Readiness-audit Group 2: TWO independent limits, because this route has
  // two different abuse shapes to close off. The IP check is the usual
  // guard against one machine hammering the endpoint. The EMAIL check is
  // the one that actually matters here and the IP check alone can't
  // provide: without it, a distributed caller rotating IPs could use this
  // endpoint as a mail bomb against one real customer's inbox — every call
  // triggers a genuine send. Checked BEFORE any lookup, and the 429 depends
  // only on request volume, never on whether the address is an account.
  const email = normaliseEmail(parsed.data.email);
  const ipLimited = isRateLimited(`password-reset-ip:${clientIp(req) ?? 'unknown'}`, {
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

  // Always 204, and the lookup and send run after the response is gone, so
  // neither the answer nor its timing says whether the address has an
  // account.
  res.status(204).end();
  void (async () => {
    const account = await findAccountByEmail(email);
    if (!account) return;
    const token = await createOneTimeToken(account.id, 'password_reset');
    await sendPasswordResetEmail(email, token);
  })().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[auth] password reset email failed:', err instanceof Error ? err.message : err);
  });
});

/** Whether a reset link is still good — the page asks before showing the form. */
authRouter.post('/password-reset/check', async (req, res) => {
  const parsed = tokenBodySchema.safeParse(req.body);
  if (!parsed.success) return res.json({ valid: false });
  return res.json({
    valid: (await peekOneTimeToken(parsed.data.token, 'password_reset')) !== null,
  });
});

/**
 * Sets a new password from a reset link. Uses the token up, marks the
 * address verified (the link proved the inbox), and signs the account out
 * everywhere — whoever knew the old password is no longer signed in. The
 * visitor then signs in with the new one.
 */
authRouter.post('/password-reset/complete', async (req, res) => {
  const parsed = passwordResetCompleteBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  const passwordHash = await hashPassword(parsed.data.password);
  const { data: accountId, error } = await attempt(() =>
    db.transaction().execute(async (trx) => {
      const id = await consumeOneTimeToken(parsed.data.token, 'password_reset', trx);
      if (!id) return null;
      await trx
        .updateTable('user_accounts')
        .set({
          password_hash: passwordHash,
          email_verified_at: sql`coalesce(email_verified_at, now())`,
        })
        .where('id', '=', id)
        .execute();
      await revokeAllAuthSessions(id, trx);
      return id;
    }),
  );
  if (error) return res.status(500).json({ error: 'Could not update your password.' });
  if (!accountId) {
    return res
      .status(400)
      .json({ error: 'That link has expired or has already been used. Request a new one.' });
  }
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
  const { data, error } = await attempt(() =>
    db
      .selectFrom('customer_addresses')
      .select(['line1', 'postcode'])
      .where('customer_id', '=', req.user!.id)
      .where('is_default', '=', true)
      .executeTakeFirst(),
  );
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
  const { data: existing, error: findError } = await attempt(() =>
    db
      .selectFrom('customer_addresses')
      .select('id')
      .where('customer_id', '=', req.user!.id)
      .where('is_default', '=', true)
      .executeTakeFirst(),
  );
  if (findError) return res.status(500).json({ error: 'Could not save your address.' });

  const { error } = await attempt(async () => {
    if (existing) {
      await db
        .updateTable('customer_addresses')
        .set({ line1: address, postcode })
        .where('id', '=', existing.id)
        .execute();
    } else {
      await db
        .insertInto('customer_addresses')
        .values({ customer_id: req.user!.id, line1: address, postcode, is_default: true })
        .execute();
    }
  });
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

/**
 * Clears the customer's current default, so a new one can be set without
 * tripping customer_addresses_one_default_idx. Best-effort, as it always was:
 * if it fails, the write that follows fails on the index instead.
 */
async function clearDefaultAddress(customerId: string) {
  await db
    .updateTable('customer_addresses')
    .set({ is_default: false })
    .where('customer_id', '=', customerId)
    .where('is_default', '=', true)
    .execute()
    .catch(() => undefined);
}

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
  const { data, error } = await attempt(() =>
    db
      .selectFrom('customer_addresses')
      .selectAll()
      .where('customer_id', '=', req.user!.id)
      .orderBy('is_default', 'desc')
      .orderBy('created_at', 'asc')
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not load your addresses.' });
  return res.json(data.map(toApiAddress));
});

authRouter.post('/customer/addresses', requireCustomer, async (req, res) => {
  const parsed = addressBookInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { label, address, postcode, isDefault } = parsed.data;

  // The customer's first address is always the default — there is no
  // sensible state where an address book has entries but no default one.
  const { count } = await db
    .selectFrom('customer_addresses')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('customer_id', '=', req.user!.id)
    .executeTakeFirstOrThrow();
  const makeDefault = isDefault === true || !count;

  if (makeDefault) {
    // The partial unique index (customer_addresses_one_default_idx) allows
    // only one is_default=true row per customer — clear the existing one
    // first, in the same request, so this insert never races that
    // constraint.
    await clearDefaultAddress(req.user!.id);
  }

  const { data, error } = await attempt(() =>
    db
      .insertInto('customer_addresses')
      .values({
        customer_id: req.user!.id,
        label: label || null,
        line1: address,
        postcode,
        is_default: makeDefault,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  if (error) return res.status(400).json({ error: 'Could not save that address.' });
  return res.status(201).json(toApiAddress(data));
});

authRouter.put('/customer/addresses/:id', requireCustomer, async (req, res) => {
  const parsed = addressBookInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { label, address, postcode, isDefault } = parsed.data;

  if (isDefault === true) {
    await clearDefaultAddress(req.user!.id);
  }

  const { data, error } = await attempt(() =>
    db
      .updateTable('customer_addresses')
      .set({
        label: label || null,
        line1: address,
        postcode,
        ...(isDefault === true ? { is_default: true } : {}),
      })
      // Both id AND customer_id — the id alone is not enough. This is what
      // stops one customer editing another's address by id.
      .where('id', '=', req.params.id ?? '')
      .where('customer_id', '=', req.user!.id)
      .returningAll()
      .executeTakeFirst(),
  );
  if (error) return res.status(500).json({ error: 'Could not save that address.' });
  if (!data) return res.status(404).json({ error: 'Address not found.' });
  return res.json(toApiAddress(data));
});

authRouter.post('/customer/addresses/:id/default', requireCustomer, async (req, res) => {
  const addressId = req.params.id ?? '';
  const target = isUuid(addressId)
    ? await db
        .selectFrom('customer_addresses')
        .select('id')
        .where('id', '=', addressId)
        .where('customer_id', '=', req.user!.id)
        .executeTakeFirst()
    : undefined;
  if (!target) return res.status(404).json({ error: 'Address not found.' });

  await clearDefaultAddress(req.user!.id);
  const { error } = await attempt(() =>
    db
      .updateTable('customer_addresses')
      .set({ is_default: true })
      .where('id', '=', target.id)
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not set that as your default.' });
  return res.status(204).end();
});

authRouter.delete('/customer/addresses/:id', requireCustomer, async (req, res) => {
  const addressId = req.params.id ?? '';
  const existing = isUuid(addressId)
    ? await db
        .selectFrom('customer_addresses')
        .select(['id', 'is_default'])
        .where('id', '=', addressId)
        .where('customer_id', '=', req.user!.id)
        .executeTakeFirst()
    : undefined;
  if (!existing) return res.status(404).json({ error: 'Address not found.' });

  const { error } = await attempt(() =>
    db
      .deleteFrom('customer_addresses')
      .where('id', '=', addressId)
      .where('customer_id', '=', req.user!.id)
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not delete that address.' });

  // Deleting the default leaves the book with no default at all, which
  // breaks checkout's autofill (it only ever looks for is_default = true) —
  // promote the next-oldest remaining address, if there is one.
  if (existing.is_default) {
    const next = await db
      .selectFrom('customer_addresses')
      .select('id')
      .where('customer_id', '=', req.user!.id)
      .orderBy('created_at', 'asc')
      .limit(1)
      .executeTakeFirst();
    if (next) {
      await db
        .updateTable('customer_addresses')
        .set({ is_default: true })
        .where('id', '=', next.id)
        .execute()
        .catch(() => undefined);
    }
  }
  return res.status(204).end();
});
