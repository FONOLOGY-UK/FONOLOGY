import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { LegalSummary, Ph } from '@/components/storefront/legal-bits';
import { getShopDetails } from '@/lib/shop-details';
import { addressLines, mailtoHref } from '@/lib/data/types';
import { ICO_COMPLAINTS_URL, LEGAL_UPDATED } from '@/lib/legal';

/** See the other legal pages: reads live shop settings, so it must not be prerendered at build. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Data protection complaints' };

/**
 * Since 19 June 2026 every organisation that handles personal data must give people a way to
 * complain to it, acknowledge the complaint within 30 days, investigate, keep the person
 * informed, and tell them the outcome (Data Protection Act 2018 s.164A, inserted by the Data
 * (Use and Access) Act 2025 s.103). UK GDPR Article 13 now also expects privacy information to
 * say people can complain to the controller as well as to the ICO — which is why the same notice
 * sits next to each form that collects details (components/storefront/data-notice.tsx).
 *
 * The law asks controllers to "facilitate" complaints, for example with an electronic form. This
 * page offers an email with the key facts pre-filled; a proper form and a place to log
 * complaints are follow-up work (see the content report).
 */
export default async function DataComplaintsPage() {
  const shop = await getShopDetails();
  const address = addressLines(shop.shopAddress).join(', ');

  const body = [
    'I am making a complaint about how my personal information has been handled.',
    '',
    'My name: [your name]',
    'How to reach me: [email / phone]',
    'Any reference (order, repair or trade-in): [reference]',
    '',
    'What happened: [describe what went wrong]',
    'What I would like you to do: [for example correct, delete or explain]',
  ].join('\n');
  const mailto = shop.shopEmail
    ? `${mailtoHref(shop.shopEmail)}?subject=${encodeURIComponent('Data protection complaint')}&body=${encodeURIComponent(body)}`
    : null;

  return (
    <LegalDocument eyebrow="Legal" title="Data protection complaints" updated={LEGAL_UPDATED}>
      <p>
        You have a right to complain to us about how we have used your personal information, and to
        the Information Commissioner&rsquo;s Office (ICO). This page explains how.
      </p>

      <LegalSummary>
        <p>Tell us what went wrong, using the details below.</p>
        <p>
          We will <strong>acknowledge your complaint within 30 days</strong>, look into it, keep you
          informed, and tell you the outcome.
        </p>
        <p>You can also complain to the ICO at any time.</p>
      </LegalSummary>

      <LegalSection title="What counts as a data protection complaint">
        <ul>
          <li>you think we have used, kept or shared your personal information wrongly;</li>
          <li>your information is wrong and we have not put it right;</li>
          <li>
            we have not answered a request to see, correct or delete your information properly;
          </li>
          <li>you are getting messages from us that you did not expect or asked us to stop;</li>
          <li>you are worried about how safely we are keeping your information.</li>
        </ul>
        <p>
          Asking to see, correct or delete your information is not a complaint, it is a request: see
          &ldquo;Your rights&rdquo; in our <Link href="/privacy">privacy notice</Link>. For any
          other complaint about goods or services, use our{' '}
          <Link href="/complaints">complaints procedure</Link>.
        </p>
      </LegalSection>

      <LegalSection title="How to complain to us">
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
            <strong>By post or in person:</strong> {address || 'the shop'}
          </li>
          <li>
            <strong>By phone:</strong> call the shop and ask to make a data protection complaint; we
            will write down what you say and send you a copy.
          </li>
        </ul>
        {mailto ? (
          <p>
            <a href={mailto} className="btn btn--ink btn--sm">
              <span className="btn__label">Start a complaint by email</span>
            </a>
          </p>
        ) : null}
        <p>Please include:</p>
        <ul>
          <li>your name and how to reach you;</li>
          <li>any order, repair or trade-in reference;</li>
          <li>what happened, and what you would like us to do.</li>
        </ul>
        <p>
          Your complaint will be handled by <Ph name="DATA_CONTACT_NAME_OR_ROLE" />.
        </p>
      </LegalSection>

      <LegalSection title="What we will do">
        <ol className="space-y-2 [&>li]:!list-decimal">
          <li>
            <strong>Acknowledge</strong> your complaint within 30 days of receiving it. (We aim to
            do it much sooner.)
          </li>
          <li>
            <strong>Look into it</strong>, asking you or our staff for more information if we need
            it, and tell you how we are getting on.
          </li>
          <li>
            <strong>Tell you the outcome</strong> without undue delay, in writing: what we found,
            what we will do about it, and your options if you are not satisfied.
          </li>
          <li>
            <strong>Learn from it</strong>: we keep a record of data complaints and use them to
            improve how we look after information.
          </li>
        </ol>
      </LegalSection>

      <LegalSection title="Complaining to the ICO">
        <p>
          You can complain to the Information Commissioner&rsquo;s Office, the UK&rsquo;s data
          protection regulator, at any time. The ICO may ask whether you have raised the problem
          with us first.
        </p>
        <ul>
          <li>
            Website:{' '}
            <a href={ICO_COMPLAINTS_URL} target="_blank" rel="noopener noreferrer">
              ico.org.uk/make-a-complaint
            </a>
          </li>
          <li>Telephone: 0303 123 1113</li>
        </ul>
        <p>
          You also have the right to take legal action in court if you believe your rights have been
          breached.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
