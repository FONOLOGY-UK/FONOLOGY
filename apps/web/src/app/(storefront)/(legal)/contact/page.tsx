import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { CompanyDetails } from '@/components/storefront/legal-bits';
import { getShopDetails } from '@/lib/shop-details';
import { addressLines, groupedHours, mailtoHref, telHref } from '@/lib/data/types';
import { LEGAL_UPDATED } from '@/lib/legal';

/**
 * Reads shop details from the API. Without this, `next build` (Docker, no API
 * reachable) prerenders the fallback (empty address, no returns window) and
 * serves it until the first hourly revalidation. The fetch inside
 * getShopDetails() is still cached for an hour.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Contact us' };

/**
 * Server Component — address, phone, email and opening hours come from the cached `/shop` fetch
 * (shop_settings), never from this file.
 *
 * It is also where the company disclosures required of a UK online trader live (Companies
 * (Trading Disclosures) Regulations and the E-Commerce Regulations 2002 reg 6: the trader's name,
 * registration details, address and an email address for quick contact).
 */
export default async function ContactPage() {
  const shop = await getShopDetails();
  const lines = addressLines(shop.shopAddress);
  const hours = groupedHours(shop.openingHours);

  return (
    <LegalDocument eyebrow="Help" title="Contact us" updated={LEGAL_UPDATED}>
      <div className="grid gap-6 sm:grid-cols-2">
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
          <ul className="mt-2 grid gap-1 [&_li]:ml-0 [&_li]:list-none">
            {hours.map((h) => (
              <li key={h.days} className="text-ink-2 flex justify-between gap-6">
                <span>{h.days}</span>
                <span className="font-semibold">{h.time}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <LegalSection title="Company details">
        <CompanyDetails
          address={shop.shopAddress}
          email={shop.shopEmail}
          phone={shop.shopPhone}
          heading={false}
        />
      </LegalSection>

      <LegalSection title="Need something specific?">
        <ul>
          <li>
            A problem with something you bought, repaired or sold to us:{' '}
            <Link href="/complaints">complaints procedure</Link>
          </li>
          <li>
            Your personal information:{' '}
            <Link href="/data-protection-complaints">data protection complaints</Link> and our{' '}
            <Link href="/privacy">privacy notice</Link>
          </li>
          <li>
            Returning or cancelling an order:{' '}
            <Link href="/returns-policy">returns, refunds &amp; cancellation</Link>
          </li>
          <li>
            Help using this website, or information in another format:{' '}
            <Link href="/accessibility">accessibility statement</Link>
          </li>
          <li>
            Following an order: <Link href="/track">track an order</Link>
          </li>
        </ul>
      </LegalSection>
    </LegalDocument>
  );
}
