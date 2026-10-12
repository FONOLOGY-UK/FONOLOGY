import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { CompanyDetails, LegalSummary, Ph } from '@/components/storefront/legal-bits';
import { getShopDetails } from '@/lib/shop-details';
import { formatGBP } from '@/lib/data/types';
import { LEGAL_UPDATED } from '@/lib/legal';

/**
 * Reads shop details from the API. Without this, `next build` (Docker, no API
 * reachable) prerenders the fallback (empty address, no returns window) and
 * serves it until the first hourly revalidation. The fetch inside
 * getShopDetails() is still cached for an hour.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Terms of sale' };

/**
 * Terms for buying goods through the website. Repairs, trade-ins and number plates have their
 * own terms (linked below) which add to these. The pre-contract information the Consumer
 * Contracts Regulations require (Schedule 2) is spread across this page, the delivery page and
 * the returns page — the checkout links all three at the pay step.
 *
 * VAT: the shop is not VAT-registered. If turnover passes the HMRC threshold (£90,000 in any 12
 * months) the "no VAT" wording here and on receipts has to change on the day it registers.
 */
export default async function TermsPage() {
  const shop = await getShopDetails();

  return (
    <LegalDocument eyebrow="Legal" title="Terms of sale" updated={LEGAL_UPDATED}>
      <p>
        These terms apply when you buy goods from us through this website. Please read them before
        you order. They are written for people buying for themselves, not for a business. Nothing in
        them takes away your legal rights as a consumer.
      </p>

      <LegalSummary>
        <p>Your order is an offer; we accept it by confirming or dispatching it.</p>
        <p>
          The price you see, plus any delivery charge shown before you pay, is the full price. We
          are not VAT-registered, so no VAT is added.
        </p>
        <p>
          You normally have 14 days to cancel an online order, and your rights if something is
          faulty are in our <Link href="/returns-policy">returns &amp; cancellation</Link> page.
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
          &ldquo;We&rdquo;, &ldquo;us&rdquo; and &ldquo;our&rdquo; mean {shop.shopName}.
          &ldquo;You&rdquo; means the person placing the order.
        </p>
      </LegalSection>

      <LegalSection title="Other terms that may apply">
        <p>Some things we do have their own terms, which add to these:</p>
        <ul>
          <li>
            <Link href="/repair-terms">Repair terms &amp; warranty</Link> &mdash; booking a repair
          </li>
          <li>
            <Link href="/trade-in-terms">Trade-in terms</Link> &mdash; selling us a device
          </li>
          <li>
            <Link href="/number-plate-terms">Number plate terms</Link> &mdash; buying number plates
          </li>
        </ul>
        <p>If those terms and these differ for that service, the specific terms apply.</p>
      </LegalSection>

      <LegalSection title="Placing an order">
        <ul>
          <li>
            The photos and descriptions on the site are as accurate as we can make them. Colours can
            vary slightly with your screen. If we say something about a product that you rely on
            when you buy it, that is part of your contract.
          </li>
          <li>
            When you press the pay button you are making an offer to buy and agreeing to pay. You
            can check and correct your details before then.
          </li>
          <li>
            Once your payment has gone through we email you an &ldquo;Order confirmed&rdquo; message
            with your reference. A contract between us exists from that point (or from dispatch, if
            that is earlier). Until then we may decline an order. Even after, if an item turns out
            to be unavailable or we cannot complete checks we are legally required to make (see
            below), we will tell you and refund everything you have paid.
          </li>
          <li>
            If we have made an obvious mistake in a price or description, we will tell you before we
            dispatch and you can choose to go ahead at the correct price or cancel for a full
            refund.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Prices and payment">
        <ul>
          <li>
            Prices are in pounds sterling. We are not registered for VAT, so no VAT is added to any
            price.
          </li>
          <li>
            The total you pay is shown in your bag and again at checkout before you pay: the goods,
            plus delivery. Delivery
            {shop.standardDeliveryPrice != null
              ? ` to the UK mainland starts at ${formatGBP(shop.standardDeliveryPrice, { alwaysShowPennies: true })}`
              : ' is charged'}
            {shop.freeDeliveryThreshold != null
              ? ` and is free when your goods come to more than ${formatGBP(shop.freeDeliveryThreshold)}`
              : ''}
            ; see <Link href="/shipping">delivery</Link>. There are no other charges and no charge
            for paying by card.
          </li>
          <li>
            Payment is taken when you place your order, through our payment processor. You can pay
            with the methods shown at checkout. If you choose a pay-later option, that
            provider&rsquo;s own terms apply to the instalment agreement; we don&rsquo;t offer
            credit ourselves.
          </li>
          <li>
            Stock changes quickly. If an item turns out to be unavailable after you have paid, we
            will tell you and refund you in full.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Delivery">
        <p>
          Our delivery options, prices and timings are on the <Link href="/shipping">delivery</Link>{' '}
          page. Unless we agree a different time, we will deliver within 30 days of your order, and
          usually much sooner. If we are late, you have rights under the Consumer Rights Act 2015 to
          set a new deadline or end the contract and be refunded. The goods are our responsibility
          until they are delivered to you.
        </p>
      </LegalSection>

      <LegalSection title="Cancelling, returns and faulty goods">
        <p>
          You normally have 14 days after you receive your goods to cancel an online order for any
          reason. Goods made to your specification &mdash; such as number plates &mdash; are an
          exception. The full rules, the cancellation form and your rights if goods are faulty are
          on the <Link href="/returns-policy">returns &amp; cancellation</Link> page. Nothing on
          that page, or in these terms, takes away your legal rights.
        </p>
      </LegalSection>

      <LegalSection title="Goods that need checks before we make or release them">
        <p>
          For some items, such as number plates, we are required by law to check documents before we
          make them. If we cannot complete the checks we will cancel the order and refund you in
          full. See the <Link href="/number-plate-terms">number plate terms</Link>.
        </p>
      </LegalSection>

      <LegalSection title="Your account and using the website">
        <p>
          You do not need an account to buy. If you create one, keep your sign-in details safe and
          tell us if you think someone else has used them. Please use the site lawfully: do not try
          to interfere with it, get into other people&rsquo;s accounts, or place orders with details
          that are not yours to use. The content on this website, including photos, text and design,
          belongs to us or is used with permission; please don&rsquo;t copy it without asking.
        </p>
      </LegalSection>

      <LegalSection title="Our responsibility to you">
        <p>
          We are responsible for loss or damage you suffer that is a foreseeable result of us
          breaking these terms or failing to take reasonable care. We are not responsible for loss
          that was not foreseeable, or for any loss of profit or other loss to a business &mdash;
          these terms are for consumers.
        </p>
        <p>
          Nothing in these terms limits our responsibility for death or personal injury caused by
          our negligence, for fraud, or for anything else the law does not allow us to limit, and
          nothing affects your legal rights about faulty goods. We are not responsible for delays or
          failures caused by events outside our reasonable control, but we will tell you promptly
          and give you the choice to cancel and be refunded if it affects your order.
        </p>
      </LegalSection>

      <LegalSection title="Looking after your personal information">
        <p>
          How we use your information is explained in our{' '}
          <Link href="/privacy">privacy notice</Link>.
        </p>
      </LegalSection>

      <LegalSection title="If something goes wrong">
        <p>
          Please tell us first and we will try to put it right &mdash; see our{' '}
          <Link href="/complaints">complaints procedure</Link>. <Ph name="ADR_STATEMENT" />
        </p>
        <p>
          These terms are governed by Scots law and the Scottish courts can decide disputes. If you
          live in England, Wales or Northern Ireland you can also bring a claim in the courts where
          you live, and you keep the consumer protection you have under the law of the part of the
          UK where you live.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update these terms from time to time. The version in force when you place an order
          is the one that applies to that order.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
