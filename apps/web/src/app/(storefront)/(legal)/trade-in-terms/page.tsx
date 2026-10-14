import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { CompanyDetails, LegalSummary, Ph } from '@/components/storefront/legal-bits';
import { getShopDetails } from '@/lib/shop-details';
import { LEGAL_UPDATED } from '@/lib/legal';

/** See the other legal pages: reads live shop settings, so it must not be prerendered at build. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Trade-in terms' };

/**
 * Matched to the sell flow (components/storefront/sell): a person reviews every request and
 * sets the price (there is no automatic pricing); the quote comes with a one-time acceptance link
 * valid for seven days (sell-accept.tsx); payout is recorded as cash or bank transfer
 * (trade_in_payouts.method); nothing is paid until the device has arrived and been checked.
 *
 * Licensing: a business that buys and resells second-hand goods in Scotland needs a second-hand
 * dealer's licence from its council (Civic Government (Scotland) Act 1982 s.24). For this shop
 * that is East Renfrewshire Council (G46 sits in that council area). The licence number is a
 * placeholder because it is the owner's to supply and confirm.
 */
export default async function TradeInTermsPage() {
  const shop = await getShopDetails();

  return (
    <LegalDocument eyebrow="Legal" title="Trade-in terms" updated={LEGAL_UPDATED}>
      <p>
        These terms apply when you sell or trade in a device to us, whether you start on this
        website or call into the shop. They are separate from our{' '}
        <Link href="/terms">terms of sale</Link>, which are for people buying from us.
      </p>

      <LegalSummary>
        <p>A real person looks at every request and sets the price. There is no automatic quote.</p>
        <p>
          You can walk away at any point until you accept our offer. We pay once your device has
          arrived and passed our checks.
        </p>
        <p>
          You promise the device is yours to sell and not stolen. We keep records of what we buy, as
          the law requires.
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
          We buy second-hand devices under a second-hand dealer&rsquo;s licence from East
          Renfrewshire Council, licence number <Ph name="SECOND_HAND_DEALER_LICENCE_NUMBER" />.
        </p>
      </LegalSection>

      <LegalSection title="How selling to us works">
        <ol className="space-y-2 [&>li]:!list-decimal">
          <li>
            <strong>You tell us about your device</strong> &mdash; the model, its condition and how
            to reach you. Be as accurate as you can: our offer depends on it.
          </li>
          <li>
            <strong>We send you an offer.</strong> A member of staff reviews your answers and sends
            a firm offer by the contact method you chose. Our first message is not an offer until it
            states a price.
          </li>
          <li>
            <strong>You accept or decline.</strong> An offer comes with a link to accept. It works
            once and expires after seven days. If you do not accept, nothing happens and the offer
            lapses. You do not have to give a reason.
          </li>
          <li>
            <strong>You get the device to us</strong> &mdash; we will tell you how, in person or by
            post. If you post it, use a tracked service and keep proof of postage; it is your risk
            until it reaches us.
          </li>
          <li>
            <strong>We check it.</strong> We check the device matches your description, that it
            works as you said, and that it is clear to sell (see below).
          </li>
          <li>
            <strong>We pay you</strong> the agreed amount by cash in the shop or by bank transfer,
            once the checks are done. We will never ask you to pay us anything to receive your
            money.
          </li>
        </ol>
      </LegalSection>

      <LegalSection title="If the device is not as described">
        <p>
          If the device is in worse condition than you described, or is locked, blocked or faulty in
          a way you didn&rsquo;t tell us about, we may change our offer. We will explain why, and
          you can accept the new price or ask for the device back. If you ask for it back,{' '}
          <Ph name="TRADE_IN_RETURN_POSTAGE_POLICY" />. We will not keep your device or pay a lower
          price without your agreement.
        </p>
      </LegalSection>

      <LegalSection title="What you promise">
        <p>By selling us a device you confirm that:</p>
        <ul>
          <li>you own it, or you have the owner&rsquo;s permission to sell it;</li>
          <li>it is not lost, stolen, or subject to a finance or hire agreement;</li>
          <li>
            it is not locked to an account you cannot remove (such as iCloud or a Google account),
            or blocked by a network;
          </li>
          <li>the details you give us are true.</li>
        </ul>
        <p>
          <strong>Before you hand it over:</strong> back up anything you want to keep, sign out of
          all accounts, turn off &ldquo;Find my device&rdquo; and reset it. We try to wipe devices
          we buy, but you are responsible for removing your personal information. See our{' '}
          <Link href="/privacy">privacy notice</Link> for what we do with the details you give us.
        </p>
      </LegalSection>

      <LegalSection title="Checks, ID and our records">
        <p>
          The law and our licence require us to keep records of what we buy. For every purchase we
          record your name and address, a description of the device (including its serial number or
          IMEI), the price we paid, and the date. We may ask to see photo ID and proof of address
          before we pay you, and we may check the device against databases of lost and stolen
          phones. The police and council licensing officers have the right to inspect these records.
          We keep them for six years.
        </p>
        <p>
          If a device is reported stolen, or we reasonably suspect it is, we may refuse to buy it,
          keep hold of it, and give it and your details to the police.
        </p>
        <p>
          Because of how the law works, we may also have to keep a device for a short period before
          we are allowed to resell it. That does not delay your payment.
        </p>
      </LegalSection>

      <LegalSection title="Changing your mind">
        <p>
          Until you accept our offer you can decline it freely. If you have already posted the
          device and then change your mind, tell us straight away, and before we have paid you. We
          will arrange for it to be returned; <Ph name="TRADE_IN_RETURN_POSTAGE_POLICY" />. Once we
          have paid you for a device that matched your description, the sale is complete.{' '}
          <Ph name="TRADE_IN_CANCELLATION_SOLICITOR_CHECK" />
        </p>
      </LegalSection>

      <LegalSection title="Our responsibility">
        <p>
          We will take reasonable care of your device from the time it reaches us. We are
          responsible for loss or damage that is a foreseeable result of our not taking that care.
          We are not responsible for a device lost or damaged in the post before we receive it.
          Nothing in these terms limits any right you have by law, or our responsibility for death,
          personal injury caused by our negligence, or fraud.
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
