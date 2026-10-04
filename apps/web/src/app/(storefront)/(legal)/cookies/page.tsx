import type { Metadata } from 'next';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';

export const metadata: Metadata = { title: 'Cookies' };

export default function CookiesPage() {
  return (
    <LegalDocument eyebrow="Legal" title="Cookie policy" updated="4 October 2026">
      <p>
        We keep storage on your device to a minimum. We use only what the site needs to work, and we
        do not use advertising or analytics cookies, so there is no cookie banner to accept.
      </p>

      <LegalSection title="What we store">
        <ul>
          <li>
            <strong>Sign-in cookie (fnl_session):</strong> set only if you sign in to an account. It
            keeps you signed in and expires after 30 days of inactivity. Without it the site cannot
            recognise you between pages.
          </li>
          <li>
            <strong>Your bag:</strong> the items in your basket are saved in your browser&rsquo;s
            local storage so they survive a reload. It stays on your device and is not sent to us
            until you check out.
          </li>
          <li>
            <strong>Payments:</strong> when you pay by card, Stripe may set its own cookies to
            prevent fraud and complete the payment. See Stripe&rsquo;s privacy policy for details.
          </li>
          <li>
            <strong>Sign in with Google:</strong> if you choose it, Google sets cookies on its own
            pages while you sign in.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Controlling them">
        <p>
          You can clear or block cookies and local storage in your browser settings. Doing so will
          sign you out and empty your bag, but you can still browse and buy as a guest.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          If we ever add analytics or marketing tools we will ask for your consent first and update
          this page. See also our <a href="/privacy">privacy policy</a>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
