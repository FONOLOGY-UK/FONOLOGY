import type { Metadata } from 'next';
import { ContentPlaceholder } from '@/components/storefront/content-placeholder';
import { getShopDetails } from '@/lib/shop-details';
import { addressLines, groupedHours, telHref, mailtoHref } from '@/lib/data/types';

export const metadata: Metadata = { title: 'Contact' };

/**
 * Server Component — details come from the cached `/shop` fetch.
 *
 * This page carried the prototype's placeholder address and phone number, on
 * the one page a customer visits specifically to find out where the shop is
 * and how to ring it.
 */
export default async function ContactPage() {
  const shop = await getShopDetails();
  const lines = addressLines(shop.shopAddress);
  const hours = groupedHours(shop.openingHours);

  return (
    <ContentPlaceholder
      eyebrow="Help"
      title="Contact us"
      note="The details below are live from the shop's settings; the surrounding page copy still comes from the client."
    >
      <div className="grid gap-6 text-sm sm:grid-cols-2">
        <div>
          <p className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">Find us</p>
          <address className="text-ink-2 mt-2 not-italic leading-relaxed">
            {lines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
          <p className="mt-3">
            {shop.shopPhone ? (
              <a href={telHref(shop.shopPhone)} className="text-ink hover:text-red font-semibold">
                {shop.shopPhone}
              </a>
            ) : null}
            <br />
            {shop.shopEmail ? (
              <a
                href={mailtoHref(shop.shopEmail)}
                className="text-ink hover:text-red font-semibold"
              >
                {shop.shopEmail}
              </a>
            ) : null}
          </p>
        </div>
        <div>
          <p className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">Hours</p>
          <ul className="mt-2 grid gap-1">
            {hours.map((h) => (
              <li key={h.days} className="text-ink-2 flex justify-between gap-6">
                <span>{h.days}</span>
                <span className="font-semibold">{h.time}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </ContentPlaceholder>
  );
}
