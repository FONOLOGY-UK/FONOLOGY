import type { Metadata } from 'next';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { getShopDetails } from '@/lib/shop-details';
import { addressLines, mailtoHref } from '@/lib/data/types';

/**
 * Reads shop details from the API. Without this, `next build` (Docker, no API
 * reachable) prerenders the fallback (empty address, no returns window) and
 * serves it until the first hourly revalidation. The fetch inside
 * getShopDetails() is still cached for an hour.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Privacy policy' };

export default async function PrivacyPage() {
  const shop = await getShopDetails();
  const address = addressLines(shop.shopAddress).join(', ');
  const days = shop.idDocumentRetentionDays;

  return (
    <LegalDocument eyebrow="Legal" title="Privacy policy" updated="4 October 2026">
      <p>
        This policy explains what personal information {shop.shopName} collects when you use this
        website or visit our shop, why we collect it, and what your rights are. We follow the UK
        GDPR and the Data Protection Act 2018.
      </p>

      <LegalSection title="Who we are">
        <p>
          {shop.shopName} is the controller of your personal information.
          {address ? ` Our shop is at ${address}.` : ''}
          {shop.shopEmail ? (
            <>
              {' '}
              You can contact us about your data at{' '}
              <a href={mailtoHref(shop.shopEmail)}>{shop.shopEmail}</a>.
            </>
          ) : null}
        </p>
      </LegalSection>

      <LegalSection title="What we collect and why">
        <ul>
          <li>
            <strong>Orders:</strong> your name, email, phone number and delivery address, what you
            bought and what you paid, so we can fulfil, deliver and support the order.
          </li>
          <li>
            <strong>Repairs and trade-ins:</strong> your contact details, the device and its fault
            or condition, the IMEI or serial number, and the quote and payment records, so we can
            carry out the work and keep our records.
          </li>
          <li>
            <strong>Accounts (optional):</strong> your email and a password, or your Google
            account&rsquo;s email and name if you sign in with Google. You never need an account to
            buy, book a repair or sell a device.
          </li>
          <li>
            <strong>Identity documents:</strong> for certain products we may ask you to upload a
            document such as a driving licence or V5C so a member of staff can check it before the
            order is released. These are stored privately, seen only by authorised staff, and
            deleted
            {days != null ? ` after ${days} days` : ' after a short fixed period'}.
          </li>
          <li>
            <strong>In the shop:</strong> sales and refund records, and for trade-ins the details we
            are required to keep.
          </li>
          <li>
            <strong>Messages and reviews:</strong> anything you send us or post as a product review.
          </li>
        </ul>
        <p>
          Our legal bases are: performing the contract with you; our legal obligations (for example
          accounting records); our legitimate interests in running the shop, preventing fraud and
          keeping the site secure; and your consent where we ask for it.
        </p>
      </LegalSection>

      <LegalSection title="Who we share it with">
        <p>
          We do not sell your data. We share it only with service providers who help us run the
          shop:
        </p>
        <ul>
          <li>
            Stripe, which processes card payments. We never see or store your full card number.
          </li>
          <li>Our delivery carriers, who receive your name, address and phone number.</li>
          <li>Our email provider, which sends order, repair and account emails on our behalf.</li>
          <li>Google, only if you choose to sign in with Google.</li>
          <li>Our hosting and backup providers, who store our systems and data.</li>
        </ul>
        <p>
          We may also disclose information where the law requires it, for example to the police or
          HMRC.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          Order, repair, trade-in and payment records are kept for six years for tax and warranty
          purposes. Identity documents are deleted as set out above. Accounts are kept until you ask
          us to close them. Sign-in sessions expire after 30 days of not using the site.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>
          You can ask us for a copy of your data, to correct it, to delete it (where we do not need
          to keep it), to restrict or object to how we use it, and to receive it in a portable
          format. To use any of these, contact us using the details above. We will answer within one
          month.
        </p>
        <p>
          If you are unhappy with how we handle your data you can complain to the Information
          Commissioner&rsquo;s Office at ico.org.uk or on 0303 123 1113.
        </p>
      </LegalSection>

      <LegalSection title="Cookies and security">
        <p>
          See our <a href="/cookies">cookie policy</a>. We protect your data with encrypted
          connections, access limited to authorised staff, and hashed passwords.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>If we change this policy we will update the date at the top of this page.</p>
      </LegalSection>
    </LegalDocument>
  );
}
