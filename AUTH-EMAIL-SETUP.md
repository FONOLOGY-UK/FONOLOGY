# Auth email setup — verification + password reset

Added as part of the fix for bug report #9 ("no verification email" / "reset link goes to
localhost, template isn't branded"). Two things are genuinely code: real email verification on
signup (`apps/api/src/routes/auth.routes.ts` — `/customer/signup` + the new
`/customer/confirm-email`), and the `redirectTo` on both that and password reset already being
env-driven (`config.webAppUrl`, from `WEB_APP_URL`). What's left is Supabase project
configuration — dashboard clicks, not code — documented here exactly because there's no
migration or PR that captures it otherwise.

**This has to be done once per Supabase project** — dev (`ohkvwqqtppvnxbvvdsfr`) and production
(`sbqqpuqoizyjzdcydqid`) are separate, so it's two passes through the same steps with different
URLs.

## 1. Env vars

| Var           | Where                                     | Dev value                                              | Production value                                          |
| ------------- | ----------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| `WEB_APP_URL` | `apps/api/.env.local` (or the host's env) | `http://localhost:3000` (the default — can be omitted) | the real storefront domain, e.g. `https://fonology.co.uk` |

This is the ONE thing that decides where every auth email link points — the confirm-signup link,
the confirm-email callback, and the password-reset link all build off it
(`${config.webAppUrl}/auth/confirm`, `/auth/callback`, `/reset-password`). **Set this before
going live** — if it's left unset in production, every auth email sends a link back to
`localhost:3000`, which is exactly the bug report #9b complaint. There is no separate "prod"
default baked in; `config.ts` only defaults to localhost, on purpose, so a forgotten env var fails
loudly (broken links in a real inbox) rather than silently working some other way.

## 2. Supabase dashboard — URL Configuration

Project → Authentication → URL Configuration:

- **Site URL**: the same value as `WEB_APP_URL` above, for that project (dev's Site URL =
  `http://localhost:3000`; production's = the live domain).
- **Redirect URLs** (allow-list — Supabase refuses to redirect anywhere not on this list):
  - `{WEB_APP_URL}/auth/confirm` — lands the signup-confirmation link
  - `{WEB_APP_URL}/auth/callback` — lands the Google OAuth redirect (already required before this
    bug fix; unaffected)
  - `{WEB_APP_URL}/reset-password` — lands the password-reset link

Wildcards work too (`{WEB_APP_URL}/**`) if simpler to manage than three exact entries — either is
fine, but the three exact paths above are the ones the code actually sends people to.

## 3. Supabase dashboard — Email Templates (the branding)

Project → Authentication → Email Templates. Two templates matter here:

- **Confirm signup** — sent automatically by `supabase.auth.signUp()` (the call
  `/customer/signup` now makes) as long as **Authentication → Providers → Email → "Confirm
  email"** is switched ON for the project. Dev already has this on (see the removed
  `email_confirm: true` shortcut this bug fix took out) — check it's on for production before
  launch, or no confirmation email sends at all and every signup is stuck on the "check your
  email" screen forever.
- **Reset password** — sent by `POST /auth/password-reset` (`supabaseAuth.auth.resetPasswordForEmail`).

Both currently use Supabase's generic default template (grey, "Supabase" branding, no logo) — the
literal complaint in bug report #9b. Replace each template's HTML with the brand-matched version
below (same red/black/bone palette `stripe-payment.tsx`'s `ELEMENTS_APPEARANCE` already uses —
`#e5231b` red, `#141414` ink). Supabase's template editor accepts raw HTML and exposes exactly one
variable that matters here: `{{ .ConfirmationURL }}` — already the full, correct link (built from
Site URL + Redirect URL + the one-time token), nothing else to construct.

**Confirm signup** — subject `Confirm your Fonology account`:

```html
<div
  style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f2ee; padding: 32px 16px;"
>
  <div
    style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden;"
  >
    <div style="background: #141414; padding: 24px 32px;">
      <span style="color: #ffffff; font-weight: 800; font-size: 18px; letter-spacing: 0.02em;"
        >FONOLOGY</span
      >
    </div>
    <div style="padding: 32px;">
      <h1 style="font-size: 20px; font-weight: 800; color: #141414; margin: 0 0 12px;">
        Confirm your account
      </h1>
      <p style="font-size: 14px; color: #4a4a4a; line-height: 1.6; margin: 0 0 24px;">
        Click below to confirm your email address and finish setting up your Fonology account.
      </p>
      <a
        href="{{ .ConfirmationURL }}"
        style="display: inline-block; background: #e5231b; color: #ffffff; font-weight: 700; font-size: 14px; text-decoration: none; padding: 13px 28px; border-radius: 8px;"
      >
        Confirm my email
      </a>
      <p style="font-size: 12px; color: #8a8a8a; line-height: 1.6; margin: 24px 0 0;">
        Didn't create a Fonology account? You can safely ignore this email.
      </p>
    </div>
  </div>
</div>
```

**Reset password** — subject `Reset your Fonology password`:

```html
<div
  style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f2ee; padding: 32px 16px;"
>
  <div
    style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden;"
  >
    <div style="background: #141414; padding: 24px 32px;">
      <span style="color: #ffffff; font-weight: 800; font-size: 18px; letter-spacing: 0.02em;"
        >FONOLOGY</span
      >
    </div>
    <div style="padding: 32px;">
      <h1 style="font-size: 20px; font-weight: 800; color: #141414; margin: 0 0 12px;">
        Reset your password
      </h1>
      <p style="font-size: 14px; color: #4a4a4a; line-height: 1.6; margin: 0 0 24px;">
        Click below to choose a new password. This link expires shortly, same as any password reset.
      </p>
      <a
        href="{{ .ConfirmationURL }}"
        style="display: inline-block; background: #e5231b; color: #ffffff; font-weight: 700; font-size: 14px; text-decoration: none; padding: 13px 28px; border-radius: 8px;"
      >
        Reset my password
      </a>
      <p style="font-size: 12px; color: #8a8a8a; line-height: 1.6; margin: 24px 0 0;">
        Didn't request this? You can safely ignore this email — your password won't change.
      </p>
    </div>
  </div>
</div>
```

## 4. Why this isn't done already

Both of the above are Supabase **dashboard** settings (URL Configuration, Email Templates) — there
is no migration, API call, or config file that can set them from this repo; someone with access to
the Supabase project has to paste the HTML in and save. This document exists so that step isn't
lost the way the deleted `HANDOVER-*.md` files were — see CLAUDE.md's Documentation map.
