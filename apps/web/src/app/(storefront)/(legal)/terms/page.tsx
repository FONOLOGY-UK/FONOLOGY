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

export const metadata: Metadata = { title: 'Terms & conditions' };

export default async function TermsPage() {
  const shop = await getShopDetails();
  const address = addressLines(shop.shopAddress).join(', ');

  return (
    <LegalDocument eyebrow="Legal" title="Terms & conditions" updated="4 October 2026">
      <p>
        These terms apply to everything you buy, book or sell through this website or in our shop.
        By placing an order or booking you agree to them. Nothing in them affects your statutory
        rights as a consumer.
      </p>

      <LegalSection title="About us">
        <p>
          This website is run by {shop.shopName}
          {address ? `, ${address}` : ''}. We are not registered for VAT, so prices are the prices
          you pay and no VAT is added.
        </p>
      </LegalSection>

      <LegalSection title="Buying from us">
        <ul>
          <li>
            Prices are in pounds sterling and include everything except delivery, which is shown at
            checkout before you pay.
          </li>
          <li>
            Your order is an offer to buy. We accept it when we confirm it by email or dispatch it.
            We can decline an order, for example if an item is out of stock, mispriced or we cannot
            verify your details, and will refund anything you have paid.
          </li>
          <li>Payment is taken by card through Stripe when you place the order.</li>
          <li>
            Stock levels change. Where an item turns out to be unavailable we will tell you and
            refund you in full.
          </li>
          <li>
            Vaping products are for customers aged 18 or over and are sold in store only. We may ask
            for proof of age or identity, and for some items for an identity document before the
            order is released.
          </li>
        </ul>
        <p>
          See <a href="/shipping">shipping &amp; delivery</a> and our{' '}
          <a href="/returns-policy">returns &amp; warranty policy</a>.
        </p>
      </LegalSection>

      <LegalSection title="Repairs">
        <ul>
          <li>
            A repair quote is based on what we can see and what you tell us. If we find something
            different once the device is opened we will contact you before doing extra work or
            charging more.
          </li>
          <li>
            Repairs can occasionally reveal hidden damage or affect water resistance and data. Back
            up your device before you hand it in; we are not responsible for data loss.
          </li>
          <li>
            Please collect your device within a reasonable time once we tell you it is ready. We may
            charge a storage fee, or dispose of or sell a device that is not collected after we have
            made reasonable attempts to contact you, as the law allows.
          </li>
          <li>
            You must be the owner of the device or authorised by the owner to have it repaired.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Selling or trading in a device to us">
        <ul>
          <li>
            Our offer depends on the device matching the condition you describe, so we check it in
            the shop. If it does not, we may change the offer; you can accept it or take the device
            back.
          </li>
          <li>
            You confirm that the device is yours to sell, is not stolen, and is not locked to an
            account such as iCloud or Google that you cannot remove. We keep a record of the sale
            and may ask for identification, and we may pass details to the police where the law
            requires it.
          </li>
          <li>Remove your accounts and personal data before you hand the device over.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Using this website">
        <p>
          Please use the site lawfully. Do not attempt to interfere with it, access other
          people&rsquo;s accounts or place orders with false details. If you create an account, keep
          your sign-in details safe. Product descriptions and photos are as accurate as we can make
          them, but colours and packaging can vary slightly.
        </p>
      </LegalSection>

      <LegalSection title="Our liability">
        <p>
          We are responsible for losses that are a foreseeable result of our breaking these terms or
          our negligence, up to the price of the goods or service. We are not responsible for
          indirect or business losses, or for delays caused by events outside our control. Nothing
          limits liability for death or personal injury caused by negligence, fraud, or anything
          else the law does not allow us to limit.
        </p>
      </LegalSection>

      <LegalSection title="Complaints and disputes">
        <p>
          If something goes wrong please tell us first and we will try to put it right. These terms
          are governed by Scots law and the Scottish courts have jurisdiction, except that if you
          live elsewhere in the UK you may also use your local courts.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update these terms. The version in force when you place an order is the one that
          applies to it.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
