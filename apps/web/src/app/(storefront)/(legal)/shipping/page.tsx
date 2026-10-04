import type { Metadata } from 'next';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { getShopDetails } from '@/lib/shop-details';
import { addressLines } from '@/lib/data/types';

/**
 * Reads shop details from the API. Without this, `next build` (Docker, no API
 * reachable) prerenders the fallback (empty address, no returns window) and
 * serves it until the first hourly revalidation. The fetch inside
 * getShopDetails() is still cached for an hour.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Shipping & delivery' };

export default async function ShippingPage() {
  const shop = await getShopDetails();
  const address = addressLines(shop.shopAddress).join(', ');

  return (
    <LegalDocument eyebrow="Help" title="Shipping & delivery" updated="4 October 2026">
      <LegalSection title="Your options">
        <ul>
          <li>
            <strong>Collect in store (free):</strong>
            {address ? ` from ${address}.` : ' from our shop.'} We will email you when your order is
            ready. Please bring your order number.
          </li>
          <li>
            <strong>Standard delivery:</strong> delivery to UK addresses.
          </li>
          <li>
            <strong>Next-day delivery:</strong> available to most UK addresses
            {shop.nextDayCutoffTime
              ? `, for orders placed before ${shop.nextDayCutoffTime} on a working day`
              : ''}
            .
          </li>
        </ul>
        <p>
          The exact price of each option for your postcode is shown at checkout before you pay. Some
          remote areas, such as the Scottish islands, cost more and may not offer next-day delivery.
        </p>
      </LegalSection>

      <LegalSection title="Timing">
        <p>
          We aim to dispatch in-stock orders on the same or the next working day. Delivery times are
          estimates, not guarantees, and can be affected by the carrier, weather and public
          holidays. We deliver to the UK only.
        </p>
      </LegalSection>

      <LegalSection title="Age-restricted and document-checked items">
        <p>
          Vaping products cannot be bought on this website; they are sold in store only to customers
          aged 18 or over. For some other items we may ask you to upload an identity document at
          checkout. We check it before the order is released, so those orders may take a little
          longer.
        </p>
      </LegalSection>

      <LegalSection title="When it arrives">
        <p>
          Please check your parcel when it arrives. If it is damaged or something is missing,
          contact us as soon as possible, with photos, so we can put it right. For returns, see our{' '}
          <a href="/returns-policy">returns policy</a>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
