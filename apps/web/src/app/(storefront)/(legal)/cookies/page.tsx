import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { LegalSummary, LegalTable } from '@/components/storefront/legal-bits';
import { LEGAL_UPDATED } from '@/lib/legal';

export const metadata: Metadata = { title: 'Cookie policy' };

/**
 * The inventory below is taken from the code, not from memory:
 *   - `fnl_session`           apps/api/src/lib/cookies.ts (SESSION_COOKIE)
 *   - `fonology-cart`         lib/stores/cart.store.ts (zustand persist)
 *   - `fonology-checkout`     lib/stores/checkout.store.ts (zustand persist; cleared on order / sign-out)
 *   - `fnl-seen`              components/storefront/home/hero.tsx (sessionStorage)
 *   - Stripe.js cookies       loaded on product pages, a non-empty bag and checkout (CLAUDE.md §13)
 * If anything is added — analytics, ads, a chat widget, an embedded video — this page and the
 * consent decision both change. PECR needs consent for anything not strictly necessary.
 */
export default function CookiesPage() {
  return (
    <LegalDocument eyebrow="Legal" title="Cookie policy" updated={LEGAL_UPDATED}>
      <p>
        Cookies are small files a website saves on your device. Some websites also use &ldquo;local
        storage&rdquo; or &ldquo;session storage&rdquo; in your browser, which works in a similar
        way. This page lists everything this website saves and why.
      </p>

      <LegalSummary>
        <p>
          We only use storage the site needs in order to work. We don&rsquo;t use advertising,
          tracking or analytics cookies.
        </p>
        <p>
          Because of that, there is no cookie banner to accept: the law only asks for your consent
          for storage that isn&rsquo;t strictly needed.
        </p>
      </LegalSummary>

      <LegalSection title="What we save on your device">
        <LegalTable
          head={['Name', 'Who sets it', 'What it does', 'How long it lasts']}
          rows={[
            [
              <code key="a">fnl_session</code>,
              'Us (cookie)',
              'Keeps you signed in to your account. It is only set if you sign in. Without it the site cannot recognise you from one page to the next.',
              'Until you sign out, or 30 days after you last used the site.',
            ],
            [
              <code key="b">fonology-cart</code>,
              'Us (local storage)',
              'Remembers what is in your bag so it is still there if you reload the page or come back later. It stays on your device.',
              'Until you check out, empty your bag or clear your browser data.',
            ],
            [
              <code key="c">fonology-checkout</code>,
              'Us (local storage)',
              'Keeps the details you have typed into the checkout form (name, email, phone, delivery address and postcode) so you do not lose them if you refresh or go back. It stays on your device and is not sent to us until you place the order.',
              'Until your order is placed or you sign out; or until you clear your browser data.',
            ],
            [
              <code key="d">fnl-seen</code>,
              'Us (session storage)',
              'Remembers that you have already seen the opening animation on the home page, so it does not play again on every visit during the same browsing session.',
              'Until you close the tab or window.',
            ],
            [
              <>
                <code>__stripe_mid</code>
                <br />
                <code>__stripe_sid</code>
              </>,
              'Our payment processor, Stripe (cookies)',
              'Help the payment processor tell genuine customers from fraudsters and keep card payments safe. They are loaded only on product pages, when your bag has items in it, and at checkout. We have no access to them and they are not used for advertising.',
              'About 1 year (__stripe_mid) and 30 minutes (__stripe_sid), according to the processor.',
            ],
          ]}
        />
        <p>
          If you choose &ldquo;Sign in with Google&rdquo;, Google sets its own cookies on
          Google&rsquo;s pages while you sign in. Those are covered by Google&rsquo;s own policies,
          not this page.
        </p>
      </LegalSection>

      <LegalSection title="Why we don&rsquo;t ask for consent">
        <p>
          The law (the Privacy and Electronic Communications Regulations, as updated by the Data
          (Use and Access) Act 2025) says we need your consent to store things on your device unless
          the storage is strictly necessary for something you have asked for &mdash; such as keeping
          you signed in, keeping your bag, or taking a payment safely. Everything in the table above
          is in that category. If we ever add anything else, for example analytics or advertising,
          we will ask for your consent first and update this page.
        </p>
      </LegalSection>

      <LegalSection title="Controlling what is saved">
        <p>
          You can clear or block cookies and local storage in your browser settings. If you do, you
          will be signed out, your bag will be emptied and the checkout form will be blank, but you
          can still browse and buy as a guest. Blocking the payment processor&rsquo;s cookies may
          stop card payments from working.
        </p>
        <p>
          On a shared computer, sign out and clear your browser data after you have used checkout.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We will update this page and its date whenever what we save changes. See also our{' '}
          <Link href="/privacy">privacy notice</Link>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
