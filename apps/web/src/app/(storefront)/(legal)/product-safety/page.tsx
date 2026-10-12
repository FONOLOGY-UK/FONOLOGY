import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { LegalSummary, Ph } from '@/components/storefront/legal-bits';
import { getShopDetails } from '@/lib/shop-details';
import { mailtoHref } from '@/lib/data/types';
import { LEGAL_UPDATED } from '@/lib/legal';

/** See the other legal pages: reads live shop settings, so it must not be prerendered at build. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Product safety & recycling' };

/**
 * Covers two separate legal duties for a shop that sells chargers, cables, power banks, plugs and
 * electronic accessories:
 *
 *  1. Product safety (General Product Safety Regulations 2005 for retailers/"distributors";
 *     Electrical Equipment (Safety) Regulations 2016 and the Plugs and Sockets etc. (Safety)
 *     Regulations 1994 for mains-connected equipment; the PSTI Act 2022 for connectable products
 *     such as Bluetooth earbuds). A retailer must only sell safe products, check marking and
 *     documents, and stop selling anything recalled. The GPSR 2005 are due to be replaced
 *     (consultation closed June 2026) — re-check this page when new rules are made.
 *  2. Waste: the WEEE Regulations 2013 require an online seller to publish take-back information
 *     on its website; the Waste Batteries and Accumulators Regulations 2009 require a battery
 *     collection point (and a notice about it) from 32 kg of portable batteries sold a year.
 *
 * The take-back route (own free take-back vs the Distributor Takeback Scheme) and the battery
 * threshold are the owner's decisions, so they are placeholders here.
 */
export default async function ProductSafetyPage() {
  const shop = await getShopDetails();

  return (
    <LegalDocument eyebrow="Help" title="Product safety & recycling" updated={LEGAL_UPDATED}>
      <p>
        We sell chargers, cables, power banks, plugs and other electrical accessories. This page
        explains how we try to make sure they are safe, what to do if you have a problem, and how to
        recycle old electrical items and batteries.
      </p>

      <LegalSummary>
        <p>We only sell products we believe are safe and meet UK rules.</p>
        <p>
          If a product is recalled we stop selling it. If you have a safety concern, tell us
          straight away.
        </p>
        <p>
          Old electricals and batteries should never go in your normal bin &mdash; we explain how to
          get rid of them properly below.
        </p>
      </LegalSummary>

      <LegalSection title="Our approach to product safety">
        <ul>
          <li>
            Electrical products we sell should carry a UKCA or CE mark, and come with instructions
            and safety information in English. Mains chargers and adaptors should have a plug that
            meets the UK plug standard.
          </li>
          <li>
            We buy from suppliers who can give us the documents that show a product meets the rules.
            We do not knowingly sell anything unsafe, and we do not sell products that have been
            recalled.
          </li>
          <li>
            If we learn that something we sold is unsafe, we will stop selling it, contact buyers we
            can reach, and tell the authorities where the law requires.
          </li>
          <li>
            Products that connect to the internet or Bluetooth must meet UK security rules,
            including telling you how long the maker will provide security updates. Where this
            applies we show the maker&rsquo;s details on the product page or with the product.{' '}
            <Ph name="CONFIRM_PSTI_INFORMATION_PROVIDED" />
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Using chargers, cables and batteries safely">
        <ul>
          <li>Use the charger and cable made for your device, or one from a reputable seller.</li>
          <li>Stop using any charger, cable or power bank that is damaged, hot, or smells odd.</li>
          <li>
            A battery that is swollen, leaking or very hot is dangerous. Stop using it, keep it away
            from anything that can burn, and take it to a proper recycling point &mdash; do not put
            it in the bin.
          </li>
          <li>
            Don&rsquo;t leave things charging under a pillow, on a bed or where they can&rsquo;t
            cool.
          </li>
          <li>Follow the instructions that came with the product.</li>
        </ul>
      </LegalSection>

      <LegalSection title="If you have a problem or concern">
        <p>
          If a product we sold you is faulty, damaged or you think it is unsafe, stop using it and
          contact us{' '}
          {shop.shopEmail ? (
            <>
              at <a href={mailtoHref(shop.shopEmail)}>{shop.shopEmail}</a>{' '}
            </>
          ) : null}
          or in the shop. See also{' '}
          <Link href="/returns-policy">returns, refunds &amp; cancellation</Link>.
        </p>
        <p>
          You can check whether a product has been recalled on the UK government&rsquo;s{' '}
          <a
            href="https://www.gov.uk/product-safety-alerts-reports-recalls"
            target="_blank"
            rel="noopener noreferrer"
          >
            product safety alerts, reports and recalls
          </a>{' '}
          page. You can report an unsafe product to Trading Standards through{' '}
          <a href="https://consumeradvice.scot" target="_blank" rel="noopener noreferrer">
            Advice Direct Scotland
          </a>
          .
        </p>
      </LegalSection>

      <section id="recycling" className="space-y-3 pt-4">
        <h2 className="text-ink text-base font-bold">Recycling old electricals</h2>
        <p>
          Anything with a plug, a battery or a cable is electrical or electronic equipment. When it
          is thrown away it is &ldquo;WEEE&rdquo;, waste electrical and electronic equipment.
        </p>
        <ul>
          <li>
            <strong>This symbol</strong> &mdash; a wheelie bin with a cross through it &mdash; on a
            product or its packaging means it must not go in your normal household bin. It must be
            collected separately.
          </li>
          <li>
            <strong>Why it matters.</strong> Electrical items contain materials that can be
            recovered and reused, and some contain substances that harm people and the environment
            if they are dumped or burned. Recycling them properly protects both.
          </li>
          <li>
            <strong>How to recycle.</strong> You can use your local council&rsquo;s household waste
            recycling centre, and many give a collection for larger items. Before you do, remove
            your personal data from phones and other devices.
          </li>
          <li>
            <strong>Reuse.</strong> If an item still works, consider selling it to us (see{' '}
            <Link href="/trade-in-terms">trade-in terms</Link>), or passing it on.
          </li>
        </ul>
        <p>
          <strong>Our take-back service.</strong> When you buy a new electrical item from us you can
          hand us an old one of the same kind, doing the same job, free of charge, whether you
          bought the new one in the shop or online. <Ph name="WEEE_TAKEBACK_ROUTE" />
        </p>
      </section>

      <LegalSection title="Used batteries">
        <p>
          Never put batteries in your normal bin or recycling box: they can start fires in bin
          lorries and recycling plants. Take them to a battery collection point &mdash; most shops
          and council recycling centres have one.
        </p>
        <p>
          <Ph name="BATTERY_COLLECTION_POINT_STATEMENT" />
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
