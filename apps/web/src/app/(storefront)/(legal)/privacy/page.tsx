import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { CompanyDetails, LegalSummary, LegalTable, Ph } from '@/components/storefront/legal-bits';
import { getShopDetails } from '@/lib/shop-details';
import { mailtoHref } from '@/lib/data/types';
import { ICO_COMPLAINTS_URL, LEGAL_UPDATED } from '@/lib/legal';

/**
 * Reads shop details from the API. Without this, `next build` (Docker, no API
 * reachable) prerenders the fallback (empty address, no returns window) and
 * serves it until the first hourly revalidation. The fetch inside
 * getShopDetails() is still cached for an hour.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Privacy notice' };

/**
 * What this page says is checked against the code: the retention periods come from the jobs in
 * apps/api/src/scripts (purge-documents, purge-sms-log, purge-housekeeping) and from
 * shop_settings; the "what we collect" rows come from the booking, trade-in, checkout and
 * account forms. If one of those changes, change this page in the same commit.
 */
export default async function PrivacyPage() {
  const shop = await getShopDetails();
  const days = shop.idDocumentRetentionDays;

  return (
    <LegalDocument eyebrow="Legal" title="Privacy notice" updated={LEGAL_UPDATED}>
      <p>
        This notice explains what personal information we collect when you use this website or visit
        our shop, why we need it, who sees it, how long we keep it, and what your rights are. We
        follow the UK GDPR and the Data Protection Act 2018.
      </p>

      <LegalSummary>
        <p>We only collect what we need to sell to you, repair your device or buy your old one.</p>
        <p>We don&rsquo;t sell your data and we don&rsquo;t send marketing emails or texts.</p>
        <p>
          You can ask to see, correct or delete your data, and you can complain to us or to the ICO
          &mdash; see <a href="#rights">your rights</a> and{' '}
          <Link href="/data-protection-complaints">how to complain</Link>.
        </p>
      </LegalSummary>

      <LegalSection title="Who is responsible for your information">
        <p>
          {shop.shopName} is the &ldquo;controller&rdquo; of your personal information, which means
          we decide how and why it is used.
        </p>
        <CompanyDetails address={shop.shopAddress} email={shop.shopEmail} phone={shop.shopPhone} />
        <p>
          For anything about your data, contact us at{' '}
          {shop.shopEmail ? <a href={mailtoHref(shop.shopEmail)}>{shop.shopEmail}</a> : 'the shop'}{' '}
          or by post at the shop address above. We are a small business and have not appointed a
          data protection officer; <Ph name="DATA_CONTACT_NAME_OR_ROLE" /> deals with data
          questions.
        </p>
      </LegalSection>

      <LegalSection title="What we collect, why, and for how long">
        <p>
          Our legal reasons (&ldquo;lawful bases&rdquo;) are: <strong>contract</strong> &mdash; we
          need it to do what you have asked us to do; <strong>legal obligation</strong> &mdash; the
          law requires us to keep it; and <strong>legitimate interests</strong> &mdash; running a
          safe, honest shop (for example preventing fraud), where this doesn&rsquo;t override your
          rights.
        </p>
        <LegalTable
          head={['What', 'Why we use it', 'Lawful basis', 'How long we keep it']}
          rows={[
            [
              <>
                <strong>Online orders:</strong> name, email, phone, delivery address, what you
                bought, what you paid, whether the payment worked.
              </>,
              'To take payment, send and deliver your order, tell you about it, handle returns and refunds.',
              'Contract; legal obligation (accounts).',
              'Six years, for tax and warranty purposes.',
            ],
            [
              <>
                <strong>Card payments:</strong> you type your card details into our payment
                processor&rsquo;s form, not ours. We receive confirmation that the payment worked.
                We never see or store your full card number.
              </>,
              'To take payment and prevent fraud.',
              'Contract; legitimate interests (fraud prevention).',
              'We keep the payment record for six years; the processor keeps card data under its own notice.',
            ],
            [
              <>
                <strong>Repair bookings:</strong> name, phone, email, address, preferred way to be
                contacted, the device, the fault, the part grade you chose, your notes, and the IMEI
                or serial number if you give it.
              </>,
              'To quote, repair and return your device, contact you, and honour the warranty.',
              'Contract.',
              'Six years.',
            ],
            [
              <>
                <strong>Trade-ins:</strong> name, phone, email, the device and its condition, our
                offer, and the payout record. If we pay you by bank transfer, the account details
                you give us.
              </>,
              'To value, buy and pay for your device, and to keep the records the law requires of businesses that buy second-hand goods.',
              'Contract; legal obligation.',
              'Six years.',
            ],
            [
              <>
                <strong>Number plate documents:</strong> pictures or scans of your driving licence
                and your vehicle registration document (V5C, V750 or similar), plus a record of your
                name, address, the registration and a reference number from your documents.
              </>,
              'The law only lets us make number plates after checking who you are and that you may use the registration, and requires us to keep a record of each sale.',
              'Legal obligation.',
              <>
                The pictures of your documents are deleted after{' '}
                {days != null ? `${days} days` : 'a short fixed period'}. The sale record is kept
                for three years. <Ph name="CONFIRM_DOC_REFERENCE_RECORDED" />
              </>,
            ],
            [
              <>
                <strong>Your account (optional):</strong> name, email, a password (stored in a
                scrambled form we cannot read) or, if you use Google sign-in, your Google name and
                email, plus any saved delivery address.
              </>,
              'To let you sign in, see your orders and save time at checkout. You never need an account to buy, book a repair or sell a device.',
              'Contract.',
              'Until you ask us to close the account. A sign-in lasts 30 days from when you last used the site. Links we email you to confirm or reset are cleared a week after they expire.',
            ],
            [
              <>
                <strong>Messages we send you:</strong> order, delivery, refund, account and repair
                emails, and text messages about your repair (your mobile number and the message).
              </>,
              'To keep you informed about what you have asked us to do.',
              'Contract.',
              'Text message content and the number are erased after 180 days. We keep a note that a message was sent.',
            ],
            [
              <>
                <strong>Anything you send us:</strong> emails, calls, in-shop conversations,
                complaints.
              </>,
              'To answer you, resolve problems and keep a record.',
              'Legitimate interests; contract.',
              'As long as needed to deal with it, and up to six years where it relates to an order, repair or trade-in.',
            ],
            [
              <>
                <strong>In the shop:</strong> sales and refund records, and for trade-ins the
                details we must record.
              </>,
              'To run the till, give refunds and meet accounting and licensing rules.',
              'Contract; legal obligation.',
              'Six years.',
            ],
            [
              <>
                <strong>Technical information</strong> such as your IP address and the pages
                requested, recorded by our servers.
              </>,
              'To keep the site secure, stop abuse and fix faults.',
              'Legitimate interests.',
              <Ph key="logs" name="SERVER_LOG_RETENTION" />,
            ],
          ]}
        />
        <p>
          We do not collect more sensitive categories of information (such as health or biometric
          data). If you tell us something like that in a note, we use it only for the job in hand.
          We do not use your information to make automated decisions about you.
        </p>
        <p>
          When you hand us a device to repair, we may come across the personal information on it.
          How we treat that is in our <Link href="/repair-terms">repair terms</Link>.
        </p>
      </LegalSection>

      <LegalSection title="Where your information comes from">
        <p>
          Mostly from you &mdash; on our forms, in the shop, or by phone and email. If you choose
          Google sign-in, Google gives us your name and email address. Nothing is bought from other
          companies.
        </p>
      </LegalSection>

      <LegalSection title="Who we share it with">
        <p>We do not sell your data. We share it only with:</p>
        <ul>
          <li>our payment processor, which takes card and other online payments for us;</li>
          <li>
            delivery carriers, who receive your name, delivery address and phone number so they can
            deliver your order;
          </li>
          <li>
            our email and text message providers, which send the messages described above on our
            behalf;
          </li>
          <li>Google, only if you choose to sign in with Google;</li>
          <li>
            our hosting and backup providers, who store our systems and data (including the private
            storage where identity documents are kept);
          </li>
          <li>our accountants and professional advisers, when we need their advice;</li>
          <li>
            the police, HMRC, DVLA, trading standards or the council&rsquo;s licensing team, where
            the law requires us to show them records (for example number plate sale records or
            records of second-hand goods we have bought).
          </li>
        </ul>
        <p>
          These providers may only use your information to provide their service to us, and we have
          contracts with them that say so. A full list of providers is available on request.
        </p>
      </LegalSection>

      <LegalSection title="Sending information outside the UK">
        <p>
          Some of our providers may handle information outside the UK. When they do, we make sure
          the law&rsquo;s safeguards apply, such as the UK government&rsquo;s approved transfer
          terms or a country the UK recognises as providing adequate protection.{' '}
          <Ph name="CONFIRM_PROVIDER_LOCATIONS" />
        </p>
      </LegalSection>

      <LegalSection title="Keeping your information safe">
        <p>
          Connections to this site are encrypted. Identity documents are stored privately, seen only
          by staff who need to check them, and opened through short-lived links. Passwords are
          stored scrambled. Staff accounts are locked when not in use. No system is perfectly
          secure; if there is a breach that puts you at risk, we will tell you and the ICO as the
          law requires.
        </p>
      </LegalSection>

      <LegalSection title="Marketing">
        <p>
          We don&rsquo;t send marketing emails or texts. The emails and texts we do send are about
          something you asked us to do. If we ever start sending marketing, we will ask for your
          consent first and every message will have a simple way to say no.
        </p>
      </LegalSection>

      <LegalSection title="Cookies and similar storage">
        <p>
          We use only what the site needs to work. The details, including names and how long each
          lasts, are in our <Link href="/cookies">cookie policy</Link>.
        </p>
      </LegalSection>

      <section id="rights" className="space-y-3 pt-4">
        <h2 className="text-ink text-base font-bold">Your rights</h2>
        <p>You can ask us to:</p>
        <ul>
          <li>tell you what information we hold about you and give you a copy;</li>
          <li>correct anything that is wrong or incomplete;</li>
          <li>delete your information, where we don&rsquo;t have to keep it;</li>
          <li>limit how we use it, or stop using it where we rely on legitimate interests;</li>
          <li>give you your information in a format you can move elsewhere;</li>
          <li>
            stop using it where you gave your consent and have changed your mind (we don&rsquo;t
            currently rely on consent for anything).
          </li>
        </ul>
        <p>
          To use any of these, contact us as shown above. There is no charge. We will reply within
          one month, and tell you if we need longer or more information to confirm who you are. Some
          records, such as order and plate-sale records, we are legally required to keep, so we may
          not be able to delete those straight away.
        </p>
      </section>

      <LegalSection title="If you are unhappy">
        <p>
          <strong>Complain to us.</strong> You have a right to complain to us about how we handle
          your information. Tell us at the contact details above. We will acknowledge your complaint
          within 30 days, look into it, keep you informed and tell you the outcome. Full details are
          on our <Link href="/data-protection-complaints">data protection complaints</Link> page.
        </p>
        <p>
          <strong>Complain to the regulator.</strong> You can also complain to the Information
          Commissioner&rsquo;s Office (ICO) at any time:{' '}
          <a href={ICO_COMPLAINTS_URL} target="_blank" rel="noopener noreferrer">
            ico.org.uk/make-a-complaint
          </a>
          , or by phone on 0303 123 1113.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          Our website is not aimed at children. If you are under 18, please ask a parent or guardian
          to place orders and book repairs for you.
        </p>
      </LegalSection>

      <LegalSection title="Changes to this notice">
        <p>
          If we change how we use your information we will update this page and its date. If a
          change matters to you, for example we want to use your details for something new, we will
          tell you before we do it.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
