import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { LegalSummary, Ph } from '@/components/storefront/legal-bits';
import { getShopDetails } from '@/lib/shop-details';
import { addressLines, mailtoHref, telHref } from '@/lib/data/types';
import { LEGAL_UPDATED } from '@/lib/legal';

/** See the other legal pages: reads live shop settings, so it must not be prerendered at build. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Complaints procedure' };

/**
 * A customer complaint about goods or services. Complaints about personal data are handled
 * under /data-protection-complaints (the Data (Use and Access) Act 2025 sets its own duties).
 *
 * ADR: since 6 April 2026 (Digital Markets, Competition and Consumers Act 2024 s.308) a trader
 * that is obliged to belong to an approved dispute-resolution scheme must say so when it tells a
 * customer the outcome of a complaint. A shop with no such scheme has nothing to name — but it
 * should say so plainly rather than leave the question open. The sentence is a placeholder
 * for the owner to settle.
 */
export default async function ComplaintsPage() {
  const shop = await getShopDetails();
  const address = addressLines(shop.shopAddress).join(', ');

  return (
    <LegalDocument eyebrow="Help" title="Complaints procedure" updated={LEGAL_UPDATED}>
      <p>
        We want to get things right. If we haven&rsquo;t, please tell us so we can put it right and
        learn from it. This page explains how to complain and what happens next.
      </p>

      <LegalSummary>
        <p>Tell us what went wrong and what you would like us to do.</p>
        <p>
          We will acknowledge your complaint within <Ph name="COMPLAINT_ACK_DAYS" /> working days
          and aim to give you a full answer within <Ph name="COMPLAINT_RESPONSE_DAYS" /> working
          days.
        </p>
        <p>
          Complaining never affects your legal rights and will not make us treat you any
          differently.
        </p>
      </LegalSummary>

      <LegalSection title="How to complain">
        <ul>
          <li>
            <strong>By email:</strong>{' '}
            {shop.shopEmail ? (
              <a href={mailtoHref(shop.shopEmail)}>{shop.shopEmail}</a>
            ) : (
              'the shop email'
            )}
          </li>
          <li>
            <strong>By phone:</strong>{' '}
            {shop.shopPhone ? (
              <a href={telHref(shop.shopPhone)}>{shop.shopPhone}</a>
            ) : (
              'the shop phone number'
            )}
          </li>
          <li>
            <strong>In person or by post:</strong> {address || 'at the shop'}
          </li>
        </ul>
        <p>It helps us if you tell us:</p>
        <ul>
          <li>your name and how to reach you;</li>
          <li>your order, repair or trade-in reference, or the date you called in;</li>
          <li>what went wrong, and what you would like us to do about it;</li>
          <li>any photos, receipts or messages that show the problem.</li>
        </ul>
        <p>
          If you tell us by phone or in the shop, we will write down what you say and send you a
          copy.
        </p>
      </LegalSection>

      <LegalSection title="What we will do">
        <ol className="space-y-2 [&>li]:!list-decimal">
          <li>
            <strong>Acknowledge it</strong> within <Ph name="COMPLAINT_ACK_DAYS" /> working days.
          </li>
          <li>
            <strong>Look into it.</strong> <Ph name="COMPLAINT_HANDLER_ROLE" /> will look at what
            happened. Someone who was not involved reviews it where we can.
          </li>
          <li>
            <strong>Reply in writing</strong> within <Ph name="COMPLAINT_RESPONSE_DAYS" /> working
            days with what we found and what we will do. If it will take longer, we will tell you
            why and when to expect an answer.
          </li>
          <li>
            <strong>Put it right</strong> where we got something wrong &mdash; a repair, a
            replacement, a refund or an apology, depending on what happened.
          </li>
        </ol>
      </LegalSection>

      <LegalSection title="If you are still not happy">
        <p>
          <Ph name="ADR_STATEMENT" />
        </p>
        <p>You can always get free, independent advice about your rights:</p>
        <ul>
          <li>
            <a href="https://consumeradvice.scot" target="_blank" rel="noopener noreferrer">
              Advice Direct Scotland (consumer advice)
            </a>{' '}
            &mdash; free advice for consumers in Scotland, which can also pass a complaint to
            Trading Standards;
          </li>
          <li>
            <a
              href="https://www.citizensadvice.org.uk/scotland/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Citizens Advice Scotland
            </a>
            ;
          </li>
          <li>your local council&rsquo;s Trading Standards service.</li>
        </ul>
        <p>
          You can also take the matter to court. In Scotland, small claims (the &ldquo;simple
          procedure&rdquo;) are a low-cost way to claim for money owed. Time limits apply, so get
          advice if you are thinking of doing this.
        </p>
      </LegalSection>

      <LegalSection title="Complaints about your personal information">
        <p>
          If your complaint is about how we have handled your personal data, see{' '}
          <Link href="/data-protection-complaints">data protection complaints</Link>, which has its
          own steps and time limits.
        </p>
      </LegalSection>

      <LegalSection title="How we use complaints">
        <p>
          We keep a record of every complaint, what we did, and what we learned, for six years. We
          use it to fix problems, not to judge you. See our{' '}
          <Link href="/privacy">privacy notice</Link>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
