import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { LegalSummary } from '@/components/storefront/legal-bits';
import { getShopDetails } from '@/lib/shop-details';
import { formatGBP, mailtoHref, telHref } from '@/lib/data/types';
import { LEGAL_UPDATED } from '@/lib/legal';

/**
 * Reads shop details from the API. Without this, `next build` (Docker, no API
 * reachable) prerenders the fallback (empty address, no returns window) and
 * serves it until the first hourly revalidation. The fetch inside
 * getShopDetails() is still cached for an hour.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Delivery' };

/**
 * Click & collect is deliberately not listed: checkout no longer offers it as a choice for a new
 * order (checkout-flow.tsx filters it out), so promising it here would be promising something a
 * customer cannot select. If it comes back, add it back here in the same change.
 */
export default async function ShippingPage() {
  const shop = await getShopDetails();

  return (
    <LegalDocument eyebrow="Help" title="Delivery" updated={LEGAL_UPDATED}>
      <p>
        We deliver to addresses in the United Kingdom. This page tells you what delivery costs, how
        long it takes, and what to do if something goes wrong.
      </p>

      <LegalSummary>
        <p>
          You see the delivery price for your address, and your total, before you pay. There are no
          other charges.
        </p>
        <p>
          We usually post in-stock orders the same or next working day. If we haven&rsquo;t
          delivered within 30 days you can cancel and be refunded.
        </p>
      </LegalSummary>

      <LegalSection title="Delivery options and prices">
        <ul>
          <li>
            <strong>Standard delivery</strong> to UK addresses
            {shop.standardDeliveryPrice != null
              ? `: ${formatGBP(shop.standardDeliveryPrice, { alwaysShowPennies: true })} to the UK mainland`
              : ''}
            .
            {shop.freeDeliveryThreshold != null
              ? ` It is free to the UK mainland when your items come to more than ${formatGBP(shop.freeDeliveryThreshold)}.`
              : ''}
          </li>
          <li>
            <strong>Next-day delivery</strong>, UK mainland only
            {shop.nextDayDeliveryPrice != null
              ? `: ${formatGBP(shop.nextDayDeliveryPrice, { alwaysShowPennies: true })}`
              : ''}
            {shop.nextDayCutoffTime
              ? `. Order before ${shop.nextDayCutoffTime.slice(0, 5)} on a working day`
              : ''}
            .
          </li>
        </ul>
        <p>
          <strong>Remote areas</strong> &mdash; the Scottish Highlands and Islands, Northern
          Ireland, the Isle of Man, the Isles of Scilly, the Isle of Wight and the Channel Islands
          &mdash; cost more and can only have standard delivery. Free delivery doesn&rsquo;t apply
          there. Enter your postcode at checkout and the exact price for your address is shown
          before you pay. We cannot deliver to BFPO addresses or outside the UK.
        </p>
      </LegalSection>

      <LegalSection title="How long it takes">
        <p>
          We aim to send in-stock orders on the same or the next working day. Delivery times we
          quote are estimates: the carrier, bad weather and public holidays can affect them.
        </p>
        <p>
          Unless we agree a different date with you, we will deliver within 30 days of your order.
          If we don&rsquo;t, you can set us a new deadline and, if we miss that, cancel and get a
          full refund &mdash; or cancel straight away if you told us before ordering that timing was
          essential. Your legal rights under the Consumer Rights Act 2015 are not affected.
        </p>
      </LegalSection>

      <LegalSection title="Orders that need a document check">
        <p>
          For some goods, such as number plates, we are required to check documents before we make
          the order, so it can take a little longer to send. You will see this before you pay. See
          the <Link href="/number-plate-terms">number plate terms</Link>.
        </p>
      </LegalSection>

      <LegalSection title="When your parcel arrives">
        <ul>
          <li>
            The goods are our responsibility until they are delivered to you, and become yours when
            you (or someone you have named) receive them.
          </li>
          <li>
            Please check the parcel when it arrives. If it is damaged or something is missing,
            contact us as soon as you can, with photos, so we can put it right. We will replace or
            refund anything damaged in transit.
          </li>
          <li>
            If you are not in, the carrier will follow its normal process for a missed delivery.
            Please make sure your address and postcode are right: if a parcel is returned to us
            because the address was wrong, we may need to charge for sending it again, and we will
            tell you the cost first.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Returns and cancellations">
        <p>
          See <Link href="/returns-policy">returns, refunds &amp; cancellation</Link> for how to
          cancel an order or send something back.
        </p>
      </LegalSection>

      <LegalSection title="Need help with an order?">
        <p>
          Track an order with your reference on the <Link href="/track">track an order</Link> page,
          or contact us
          {shop.shopEmail ? (
            <>
              {' '}
              at <a href={mailtoHref(shop.shopEmail)}>{shop.shopEmail}</a>
            </>
          ) : null}
          {shop.shopPhone ? (
            <>
              {' '}
              or on <a href={telHref(shop.shopPhone)}>{shop.shopPhone}</a>
            </>
          ) : null}
          .
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
