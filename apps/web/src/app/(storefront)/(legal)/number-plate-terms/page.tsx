import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { CompanyDetails, LegalSummary, Ph } from '@/components/storefront/legal-bits';
import { getShopDetails } from '@/lib/shop-details';
import { LEGAL_UPDATED } from '@/lib/legal';

/** See the other legal pages: reads live shop settings, so it must not be prerendered at build. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Number plate terms' };

/**
 * Matched to checkout's "Verify your number plate" step: the customer uploads TWO documents (a
 * V5C / V750 or other registration document, and a driving licence) before paying; staff check
 * them before the plates are made; the images are deleted after
 * shop_settings.id_document_retention_days.
 *
 * Law behind it: the Road Vehicles (Display of Registration Marks) Regulations 2001 and DVLA's
 * Register of Number Plate Suppliers rules (suppliers must be registered, check original
 * documents that prove name and address AND entitlement to the registration, and keep a record
 * for three years); Consumer Contracts Regulations 2013 reg 28(1)(b) (no 14-day right for goods
 * made to the customer's specification or clearly personalised).
 *
 * Two things this page describes that the system must actually do, listed in the follow-ups:
 *   1. a three-year sale record including a reference number from the customer's documents
 *      (the images are deleted early, so the number has to be captured separately), and
 *   2. DVLA asks suppliers to check ORIGINAL documents — whether a remote upload satisfies that
 *      is for DVLA / a solicitor to confirm.
 */
export default async function NumberPlateTermsPage() {
  const shop = await getShopDetails();
  const days = shop.idDocumentRetentionDays;

  return (
    <LegalDocument eyebrow="Legal" title="Number plate terms" updated={LEGAL_UPDATED}>
      <p>
        These terms apply when you order number plates from us. They add to our{' '}
        <Link href="/terms">terms of sale</Link>. The law controls who can have number plates made,
        so we have to check a few things before we make yours.
      </p>

      <LegalSummary>
        <p>
          We can only make plates after checking <strong>who you are</strong> and{' '}
          <strong>that you may use the registration</strong>. You upload two documents when you
          order.
        </p>
        <p>
          Plates are made specially for you, so you can&rsquo;t cancel them under the 14-day online
          cancellation right once you have ordered. You are still protected if they are faulty or
          not as ordered.
        </p>
        <p>
          If we can&rsquo;t complete the checks, we don&rsquo;t make the plates and you get a full
          refund.
        </p>
      </LegalSummary>

      <LegalSection title="Who we are">
        <CompanyDetails
          address={shop.shopAddress}
          email={shop.shopEmail}
          phone={shop.shopPhone}
          heading={false}
        />
        <p>
          We are a registered number plate supplier on the DVLA&rsquo;s Register of Number Plate
          Suppliers, registration number <Ph name="DVLA_SUPPLIER_NUMBER" />. You can check the
          register on GOV.UK. Only a registered supplier may make up number plates.
        </p>
      </LegalSection>

      <LegalSection title="What you need to order">
        <p>When you order plates you will be asked to upload:</p>
        <ul>
          <li>
            <strong>Proof of who you are and where you live</strong>, normally your driving licence.
            (DVLA also accepts a recent utility, Council Tax or bank statement for name and address,
            and for name only, a passport or bank card.)
          </li>
          <li>
            <strong>Proof you are allowed to use the registration number</strong> &mdash; usually
            the vehicle registration certificate (V5C) or the new keeper slip, or other DVLA
            documents such as a V750 certificate of entitlement, a V778 retention document or a V948
            authorisation.
          </li>
        </ul>
        <p>
          You do not have to be the registered keeper. If you are buying plates for someone else,
          you must show your own identity documents together with documents that show their
          entitlement to the registration.
        </p>
        <p>
          Our checkout asks for pictures or scans (PDF or photo). DVLA&rsquo;s rules expect
          suppliers to check original documents, so we may ask to see the originals before we make
          or hand over your plates. <Ph name="PLATE_ORIGINALS_POLICY" />
        </p>
      </LegalSection>

      <LegalSection title="What we do with your documents">
        <ul>
          <li>
            A member of staff checks them. They are kept in private storage and only the staff who
            do the checks can open them.
          </li>
          <li>
            We delete the pictures of your documents after{' '}
            {days != null ? `${days} days` : 'a short fixed period'}.
          </li>
          <li>
            The law requires us to keep a{' '}
            <strong>record of every plate sale for three years</strong>: your name and address, the
            registration number, and a reference number taken from your documents. We keep that
            record after your pictures are deleted, and DVLA, the police and trading standards
            officers have the right to inspect it. <Ph name="CONFIRM_DOC_REFERENCE_RECORDED" />
          </li>
        </ul>
        <p>
          Our <Link href="/privacy">privacy notice</Link> gives the full details of how we handle
          your information and your rights.
        </p>
      </LegalSection>

      <LegalSection title="If we can&rsquo;t verify you">
        <p>
          We make the plates only after the checks are complete. If the documents are unclear, do
          not match, or do not show you are entitled to the registration, we will contact you. If we
          cannot complete the checks we will cancel the order and refund everything you paid,
          including delivery.
        </p>
      </LegalSection>

      <LegalSection title="Plates are made to order">
        <p>
          Number plates are made to your specification &mdash; with your registration on them. That
          is why the usual 14-day right to cancel an online order does not apply to them once you
          have ordered. <Ph name="PLATE_CANCEL_BEFORE_PRODUCTION_POLICY" />
        </p>
        <p>
          Your other rights are not affected. If your plates are faulty, damaged, or not what you
          ordered &mdash; for example if we put a different registration on them from the one you
          gave us &mdash; we will remake them or refund you. See{' '}
          <Link href="/returns-policy">returns, refunds &amp; cancellation</Link>.
        </p>
      </LegalSection>

      <LegalSection title="Check your registration before you order">
        <p>
          We make plates for the registration you type. Please check it carefully before you pay: if
          you enter it wrongly and we make it as you entered it, we can&rsquo;t treat that as our
          mistake. We will check it against your documents and tell you if it does not match.
        </p>
      </LegalSection>

      <LegalSection title="Using your plates legally">
        <ul>
          <li>
            You must show the registration number correctly. You cannot rearrange the letters or
            numbers, or change them so they are hard to read.
          </li>
          <li>
            A vehicle with incorrect plates can fail its MOT and the driver can be fined up to
            £1,000.
          </li>
          <li>
            Our plates are made to the UK standard for road vehicle plates.{' '}
            <Ph name="CONFIRM_PLATES_MEET_BS_AU_145E" /> We may refuse to make or alter a plate that
            would not be legal on the road.
          </li>
          <li>
            Fitting the plates is your responsibility. The law is on GOV.UK under &ldquo;displaying
            number plates&rdquo;.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Delivery">
        <p>
          Plates are posted as set out on our <Link href="/shipping">delivery</Link> page, once they
          have been made. Orders that need a document check take a little longer.
        </p>
      </LegalSection>

      <LegalSection title="If something goes wrong">
        <p>
          Tell us and we will try to put it right &mdash; see our{' '}
          <Link href="/complaints">complaints procedure</Link>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
