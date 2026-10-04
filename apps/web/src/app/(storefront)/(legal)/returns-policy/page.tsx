import type { Metadata } from 'next';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { getShopDetails } from '@/lib/shop-details';
import { mailtoHref, telHref } from '@/lib/data/types';

/**
 * Reads shop details from the API. Without this, `next build` (Docker, no API
 * reachable) prerenders the fallback (empty address, no returns window) and
 * serves it until the first hourly revalidation. The fetch inside
 * getShopDetails() is still cached for an hour.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Returns & warranty' };

/**
 * Server Component, so the returns window comes from the cached `/shop` fetch
 * rather than a hook. It used to print a hardcoded 30 — on the page whose
 * entire job is stating the shop's returns policy correctly.
 *
 * If the fetch failed the window is null, and this page states no number at
 * all. On the returns policy page specifically, a confidently wrong number is
 * the worst possible output: it is the page a customer would screenshot.
 */
export default async function ReturnsPolicyPage() {
  const shop = await getShopDetails();
  const days = shop.returnWindowDays;

  return (
    <LegalDocument eyebrow="Legal" title="Returns & warranty" updated="4 October 2026">
      <LegalSection title="Your statutory rights">
        <p>
          Nothing on this page limits your legal rights under the Consumer Rights Act 2015. Goods
          must be of satisfactory quality, fit for purpose and as described.
        </p>
      </LegalSection>

      <LegalSection title="Changing your mind">
        <p>
          {days != null
            ? `You can return most unused items in their original condition within ${days} days of purchase for a refund, with your receipt or order number.`
            : 'You can return most unused items in their original condition for a refund, with your receipt or order number.'}{' '}
          If you bought online or by phone, you also have at least 14 days from the day you receive
          your order to cancel it under the Consumer Contracts Regulations. Tell us in writing, then
          send the item back within 14 days of telling us. Please keep it protected on the way, as
          you are responsible for it until we receive it.
        </p>
        <p>
          We refund the price you paid, and standard delivery if you cancel the whole order, to the
          original payment method within 14 days of receiving the item back.
        </p>
      </LegalSection>

      <LegalSection title="Things we cannot take back for change of mind">
        <ul>
          <li>Items that have been used, damaged or are missing parts or packaging.</li>
          <li>Opened vaping products and e-liquids, for hygiene and safety reasons.</li>
          <li>Phones and other devices that have been unlocked, reset or altered by you.</li>
          <li>Repairs that have already been completed at your request.</li>
        </ul>
        <p>This does not affect your rights if an item is faulty.</p>
      </LegalSection>

      <LegalSection title="Faulty items">
        <p>
          If something is faulty, tell us. Within 30 days of purchase you can reject it for a
          refund. After that we will offer a repair or replacement, and if that is not possible a
          partial or full refund. We pay the return costs for faulty goods.
        </p>
      </LegalSection>

      <LegalSection title="Repair warranty">
        <p>
          Repairs carry the warranty shown on your quote and receipt, which depends on the part
          quality you chose. It covers the repaired part and the work, not new damage. It does not
          cover accidental damage, liquid damage or further breakage after you collect the device,
          or repairs that have been opened or worked on by someone else. If a repaired part fails
          within the warranty, bring it back and we will put it right.
        </p>
      </LegalSection>

      <LegalSection title="Product warranty">
        <p>
          New and refurbished devices and accessories come with the warranty described on the
          product page or your receipt. Keep your receipt or order confirmation as proof of
          purchase.
        </p>
      </LegalSection>

      <LegalSection title="How to return something">
        <p>
          Bring it to the shop with your receipt, or contact us first if you bought online
          {shop.shopPhone ? (
            <>
              {' '}
              on <a href={telHref(shop.shopPhone)}>{shop.shopPhone}</a>
            </>
          ) : null}
          {shop.shopEmail ? (
            <>
              {' '}
              or <a href={mailtoHref(shop.shopEmail)}>{shop.shopEmail}</a>
            </>
          ) : null}
          . We will tell you where to send it.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
