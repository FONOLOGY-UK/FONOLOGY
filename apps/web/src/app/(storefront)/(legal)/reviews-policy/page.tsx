import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { LegalSummary, Ph } from '@/components/storefront/legal-bits';
import { getShopDetails } from '@/lib/shop-details';
import { mailtoHref } from '@/lib/data/types';
import { LEGAL_UPDATED } from '@/lib/legal';

/** See the other legal pages: reads live shop settings, so it must not be prerendered at build. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Reviews policy' };

/**
 * The Digital Markets, Competition and Consumers Act 2024 bans fake reviews, hiding that a
 * review was paid for or otherwise rewarded, and misleading selection of reviews; the CMA expects
 * a business that publishes reviews to have a clear policy for preventing and removing them.
 *
 * This page can only be as true as the facts behind the reviews on the home page. The 8 reviews
 * that ship in migration 0053 are seed data: the owner must confirm they are genuine Google
 * reviews, from real customers, quoted accurately — until then the page says so with a
 * placeholder rather than asserting it.
 */
export default async function ReviewsPolicyPage() {
  const shop = await getShopDetails();

  return (
    <LegalDocument eyebrow="Help" title="Reviews policy" updated={LEGAL_UPDATED}>
      <p>
        Reviews help people decide where to spend their money, so they have to be honest. This page
        explains where the reviews on this website come from and the rules we follow.
      </p>

      <LegalSummary>
        <p>
          The reviews we show are real, from real customers, and are not paid for.{' '}
          <Ph name="CONFIRM_REVIEWS_ARE_GENUINE" />
        </p>
        <p>We don&rsquo;t write, edit or hide reviews to make ourselves look better.</p>
      </LegalSummary>

      <LegalSection title="Where our reviews come from">
        <p>
          The reviews shown on our home page are <Ph name="REVIEWS_SOURCE_AND_SELECTION" />
        </p>
      </LegalSection>

      <LegalSection title="Our rules">
        <ul>
          <li>
            <strong>Every review comes from a real customer.</strong> We never write or commission
            fake reviews, and we never ask friends, family or staff to review us as if they were
            customers.
          </li>
          <li>
            <strong>We don&rsquo;t pay for reviews, or reward them.</strong> We don&rsquo;t give
            discounts, gifts or anything else in return for a review, positive or otherwise. If we
            ever do, we will say so next to the review.
          </li>
          <li>
            <strong>We ask every customer the same way.</strong> We don&rsquo;t ask only the happy
            ones.
          </li>
          <li>
            <strong>We don&rsquo;t pick only the good ones.</strong> If we show a selection of
            reviews rather than all of them, we say so, and we don&rsquo;t leave out reviews because
            they are critical.
          </li>
          <li>
            <strong>We don&rsquo;t change what a review says.</strong> A review is shown as the
            customer wrote it. If we shorten one, we mark the cut.
          </li>
          <li>
            <strong>We remove only reviews that break the rules</strong> &mdash; for example fake
            reviews, reviews about a different business, or reviews that are abusive, unlawful or
            contain someone else&rsquo;s personal details. We don&rsquo;t remove a review just
            because it is negative.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Think a review isn&rsquo;t genuine?">
        <p>
          Tell us{' '}
          {shop.shopEmail ? (
            <>
              at <a href={mailtoHref(shop.shopEmail)}>{shop.shopEmail}</a>{' '}
            </>
          ) : null}
          and we will look into it and remove it if it breaks our rules. You can also report a
          review on the site where it was originally posted. See our{' '}
          <Link href="/complaints">complaints procedure</Link> if you are not happy with how we
          handle it.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
