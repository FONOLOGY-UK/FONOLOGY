import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { LegalSummary, Ph } from '@/components/storefront/legal-bits';
import { getShopDetails } from '@/lib/shop-details';
import { addressLines, mailtoHref, telHref } from '@/lib/data/types';
import { LEGAL_TRADER_NAME, LEGAL_UPDATED } from '@/lib/legal';

/**
 * Reads shop details from the API. Without this, `next build` (Docker, no API
 * reachable) prerenders the fallback (empty address, no returns window) and
 * serves it until the first hourly revalidation. The fetch inside
 * getShopDetails() is still cached for an hour.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Returns, refunds & cancellation' };

/**
 * Server Component, so the returns window comes from the cached `/shop` fetch
 * rather than a hook. If the fetch failed the window is null, and this page states no number at
 * all: on the page a customer would screenshot, a confidently wrong number is the worst output.
 *
 * Legal basis (all UK): Consumer Contracts (Information, Cancellation and Additional Charges)
 * Regulations 2013 (14-day cancellation of distance sales, reg 28 exceptions, Schedule 3 model
 * form) and the Consumer Rights Act 2015 (faulty goods, s.22 30-day short-term right to reject).
 * The in-store window below is the shop's own goodwill policy, on top of those.
 */
export default async function ReturnsPolicyPage() {
  const shop = await getShopDetails();
  const days = shop.returnWindowDays;
  const address = addressLines(shop.shopAddress).join(', ');

  const formBody = [
    `To: ${LEGAL_TRADER_NAME}${address ? `, ${address}` : ''}${shop.shopEmail ? `, ${shop.shopEmail}` : ''}`,
    '',
    'I hereby give notice that I cancel my contract of sale of the following goods:',
    '[describe the goods]',
    '',
    'Ordered on: [date]  /  Received on: [date]',
    'Order reference: [reference]',
    'Name: [your name]',
    'Address: [your address]',
    'Date: [date]',
  ].join('\n');
  const mailto = shop.shopEmail
    ? `${mailtoHref(shop.shopEmail)}?subject=${encodeURIComponent('Cancellation of my order')}&body=${encodeURIComponent(formBody)}`
    : null;

  return (
    <LegalDocument eyebrow="Legal" title="Returns, refunds & cancellation" updated={LEGAL_UPDATED}>
      <p>
        This page explains how to cancel an order, return something, get a refund, and what we will
        do if something you buy from us is faulty. Nothing here takes away your legal rights under
        the Consumer Rights Act 2015 or the Consumer Contracts Regulations 2013.
      </p>

      <LegalSummary>
        <p>
          <strong>Bought online?</strong> You can cancel for any reason within 14 days of receiving
          your goods, and we refund you.
        </p>
        <p>
          <strong>Bought in the shop?</strong>{' '}
          {days != null
            ? `You can return most unused items within ${days} days with your receipt.`
            : 'You can return most unused items with your receipt.'}
        </p>
        <p>
          <strong>Faulty?</strong> Tell us. You have a legal right to a refund, repair or
          replacement, and we pay the return costs.
        </p>
        <p>
          <strong>Number plates</strong> are made to order, so the 14-day right doesn&rsquo;t apply
          to them, but you are still protected if they are faulty or not as described.
        </p>
      </LegalSummary>

      <LegalSection title="Cancelling an online order (14 days)">
        <p>
          If you buy from us online, by phone or by email, you have the right to cancel for any
          reason during the <strong>cancellation period</strong>. It ends 14 days after the day you
          (or someone you name) receive the goods. If your order comes in several deliveries, it
          ends 14 days after the last one arrives.
        </p>
        <p>
          <strong>How to cancel.</strong> Tell us clearly that you want to cancel, by email, post or
          phone, before the period ends. You can use the form further down this page, but you
          don&rsquo;t have to &mdash; any clear message will do. We will confirm in writing that we
          have received it.
        </p>
        <p>
          <strong>Sending the goods back.</strong> Send them back to us, or bring them to the shop,
          within 14 days of telling us you are cancelling. Please pack them so they arrive undamaged
          &mdash; they are your responsibility until we receive them. You pay the cost of sending
          them back, unless they are faulty or not what you ordered. Tell us first and we will give
          you the address to use.
        </p>
        <p>
          <strong>Your refund.</strong> We refund the price of the goods, and the cost of standard
          delivery if you cancel the whole order, to the payment method you used. We do this within
          14 days of getting the goods back, or of you showing us proof that you sent them,
          whichever is earlier. If you chose a faster delivery than our standard service, we cannot
          refund the extra cost.
        </p>
        <p>
          <strong>Taking care of the goods.</strong> You may open and try goods as you could in a
          shop, but not use them beyond that. If goods come back used, damaged or incomplete we may
          reduce your refund by the amount they have lost in value.
        </p>
      </LegalSection>

      <LegalSection title="Things the 14-day right does not cover">
        <ul>
          <li>
            <strong>Goods made to your order or clearly personalised</strong>, such as number
            plates. We make these specially for you, so once you have ordered them you can&rsquo;t
            cancel under the 14-day right. See the{' '}
            <Link href="/number-plate-terms">number plate terms</Link>.
          </li>
          <li>
            <strong>Sealed goods that cannot be returned for health or hygiene reasons</strong> once
            you have unsealed them after delivery. We say so on the product page where this applies.
          </li>
          <li>
            <strong>Services we have fully carried out</strong> after you asked us to start, such as
            a repair &mdash; see the <Link href="/repair-terms">repair terms</Link> for your
            cancellation rights for repairs.
          </li>
        </ul>
        <p>None of this affects your rights if goods are faulty or not as described.</p>
      </LegalSection>

      <LegalSection title="Buying in the shop">
        <p>
          The 14-day right above is for online, phone and email orders. For goods you buy in the
          shop, you have the same rights if the goods are faulty. On top of that, as a courtesy,{' '}
          {days != null
            ? `we accept most unused items back within ${days} days for a refund`
            : 'we accept most unused items back for a refund'}{' '}
          if they are in their original condition and you bring your receipt. This is our own
          policy, and it doesn&rsquo;t apply to items we have made to order, items that have been
          used, damaged or have missing parts, or phones and devices that have been unlocked, reset
          or changed by you. <Ph name="RETURNS_GOODWILL_EXCEPTIONS_CONFIRM" />
        </p>
      </LegalSection>

      <LegalSection title="If something is faulty">
        <p>
          By law, goods must be of satisfactory quality, fit for their purpose, and as described. If
          they are not:
        </p>
        <ul>
          <li>
            <strong>Within 30 days</strong> of getting them you can reject them and get a full
            refund.
          </li>
          <li>
            <strong>After 30 days</strong> you can ask us to repair or replace them. If that is not
            possible, or does not work, you can ask for a price reduction, or to return them for a
            refund (we may take into account the use you have had).
          </li>
          <li>
            In the <strong>first six months</strong> we will assume the fault was there when you got
            the goods, unless we can show otherwise. After six months you may need to show it was.
          </li>
          <li>
            We pay the cost of returning faulty goods, and we refund you within 14 days of agreeing
            you are entitled to a refund.
          </li>
        </ul>
        <p>
          Your rights to claim last for years, not days: in Scotland you have five years from the
          date you found the fault (or could reasonably have found it).
        </p>
        <p>
          To start a claim, contact us with your order number or receipt and, if you can, a photo of
          the problem.
        </p>
      </LegalSection>

      <LegalSection title="Warranties">
        <p>
          Some items come with a warranty from us, described on the product page or your receipt. A
          warranty is extra: it never replaces your legal rights above. Repairs have their own
          warranty &mdash; see the <Link href="/repair-terms">repair terms</Link>. Keep your receipt
          or order confirmation as proof of purchase.
        </p>
      </LegalSection>

      <LegalSection title="How to contact us about a return or cancellation">
        <p>
          {shop.shopEmail ? (
            <>
              Email <a href={mailtoHref(shop.shopEmail)}>{shop.shopEmail}</a>
            </>
          ) : (
            'Contact the shop'
          )}
          {shop.shopPhone ? (
            <>
              {' '}
              or phone <a href={telHref(shop.shopPhone)}>{shop.shopPhone}</a>
            </>
          ) : null}
          {address ? `, or write to us at ${address}` : ''}. If you are unhappy with how we deal
          with it, see our <Link href="/complaints">complaints procedure</Link>.
        </p>
      </LegalSection>

      <section id="cancellation-form" className="space-y-3 pt-4">
        <h2 className="text-ink text-base font-bold">Cancellation form</h2>
        <p>
          You can copy this, print it, or use the button to open an email with it filled in. You
          don&rsquo;t have to use it. Delete anything that does not apply.
        </p>
        <div className="legal-form" role="group" aria-label="Model cancellation form">
          <p>
            <strong>To:</strong> {LEGAL_TRADER_NAME}
            {address ? `, ${address}` : ''}
            {shop.shopEmail ? `, ${shop.shopEmail}` : ''}
          </p>
          <p>
            I/We* hereby give notice that I/We* cancel my/our* contract of sale of the following
            goods*/for the supply of the following service*:
          </p>
          <p className="legal-form__blank">&nbsp;</p>
          <p className="legal-form__field">
            <span>Ordered on* / received on*:</span>
            <i aria-hidden="true" />
          </p>
          <p className="legal-form__field">
            <span>Name of consumer(s):</span>
            <i aria-hidden="true" />
          </p>
          <p className="legal-form__field">
            <span>Address of consumer(s):</span>
            <i aria-hidden="true" />
          </p>
          <p className="legal-form__field">
            <span>Signature of consumer(s) (only if this form is sent on paper):</span>
            <i aria-hidden="true" />
          </p>
          <p className="legal-form__field">
            <span>Date:</span>
            <i aria-hidden="true" />
          </p>
          <p className="legal-form__note">* Delete as appropriate.</p>
        </div>
        {mailto ? (
          <p>
            <a href={mailto} className="btn btn--ink btn--sm">
              <span className="btn__label">Open as an email</span>
            </a>
          </p>
        ) : null}
      </section>
    </LegalDocument>
  );
}
