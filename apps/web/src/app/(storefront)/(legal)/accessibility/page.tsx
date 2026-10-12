import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { LegalSummary, Ph } from '@/components/storefront/legal-bits';
import { getShopDetails } from '@/lib/shop-details';
import { mailtoHref, telHref } from '@/lib/data/types';
import { LEGAL_UPDATED } from '@/lib/legal';

/** See the other legal pages: reads live shop settings, so it must not be prerendered at build. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Accessibility statement' };

/**
 * A private shop is not required to publish an accessibility statement (the statutory model
 * statement is for public-sector bodies), but the Equality Act 2010 requires reasonable
 * adjustments for disabled customers — including on a website — and WCAG 2.2 AA is the standard
 * to aim for. A statement tells a customer how to ask for help.
 *
 * Do not let this claim more than has been tested. The "known issues" list is from the October
 * 2026 automated accessibility checks (axe, WCAG 2.2 AA) and the developer's own review. Update
 * the list and the date whenever those change.
 */
export default async function AccessibilityPage() {
  const shop = await getShopDetails();

  return (
    <LegalDocument eyebrow="Help" title="Accessibility statement" updated={LEGAL_UPDATED}>
      <p>
        We want everyone to be able to use this website, including disabled people and people who
        use assistive technology. This statement explains what we have done, what is not yet right,
        and how to get help.
      </p>

      <LegalSummary>
        <p>We aim for the Web Content Accessibility Guidelines (WCAG) 2.2, level AA.</p>
        <p>
          Some things are not yet fully there &mdash; they are listed below. If you can&rsquo;t use
          something, tell us and we will help another way.
        </p>
      </LegalSummary>

      <LegalSection title="What we have done">
        <ul>
          <li>There is a &ldquo;skip to main content&rdquo; link at the top of every page.</li>
          <li>
            Pages are built with headings, form labels and page landmarks (header, navigation, main
            content and footer) so screen readers can find their way around.
          </li>
          <li>
            The site works at phone widths, and on desktop when you zoom in or enlarge the text.
          </li>
          <li>Animations are switched off if your device is set to &ldquo;reduce motion&rdquo;.</li>
          <li>
            You never need an account to buy, book a repair or sell a device, and you can always ask
            us to do any of these in the shop instead.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Known problems">
        <p>
          We tested this website with automated accessibility tools against WCAG 2.2 AA in October
          2026 and reviewed the results ourselves. We have not yet had an independent audit (
          <Ph name="ACCESSIBILITY_AUDIT_PLAN" />
          ). These are the problems we know about:
        </p>
        <ul>
          <li>
            <strong>
              Some red text on pale backgrounds is slightly below the recommended contrast
            </strong>{' '}
            (WCAG 1.4.3), for example some small red labels. It is still readable for most people,
            but not for everyone. We are fixing it.
          </li>
          <li>
            <strong>Product photos are described only by the product&rsquo;s name.</strong> On lists
            of products they are treated as decorative, with the name and details in text beside
            them.
          </li>
          <li>
            <strong>The card payment form is provided by our payment processor</strong> and sits
            inside our checkout, so we can&rsquo;t change how it works. If you can&rsquo;t use it,
            contact us and we will help you another way.{' '}
            <Ph name="ACCESSIBLE_PAYMENT_ALTERNATIVE" />
          </li>
          <li>
            <strong>Some pages are slow on older phones.</strong> We know that can make the site
            hard to use for some people and are working on it.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Tell us if you need help">
        <p>
          If you can&rsquo;t use any part of this site, or you need information in a different
          format &mdash; large print, easy read, audio, or a call instead of a form &mdash; please
          contact us:
        </p>
        <ul>
          <li>
            Email:{' '}
            {shop.shopEmail ? (
              <a href={mailtoHref(shop.shopEmail)}>{shop.shopEmail}</a>
            ) : (
              'the shop email'
            )}
          </li>
          <li>
            Phone:{' '}
            {shop.shopPhone ? (
              <a href={telHref(shop.shopPhone)}>{shop.shopPhone}</a>
            ) : (
              'the shop phone number'
            )}
          </li>
          <li>In person at the shop.</li>
        </ul>
        <p>
          We will reply within <Ph name="ACCESSIBILITY_REPLY_DAYS" /> working days and aim to give
          you what you need in a way that works for you.
        </p>
      </LegalSection>

      <LegalSection title="If you are not happy with our reply">
        <p>
          You can use our <Link href="/complaints">complaints procedure</Link>. If you think we have
          treated you unfairly because of a disability, you can get free advice from the{' '}
          <a
            href="https://www.equalityadvisoryservice.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Equality Advisory and Support Service
          </a>
          , and the Equality and Human Rights Commission (EHRC) enforces the Equality Act 2010 in
          Great Britain.
        </p>
      </LegalSection>

      <LegalSection title="How this statement was prepared">
        <p>
          This statement was prepared on {LEGAL_UPDATED}. It will be reviewed whenever we make a
          significant change to the site, and at least once a year.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
