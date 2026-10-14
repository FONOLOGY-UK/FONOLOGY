import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, LegalSection } from '@/components/storefront/legal-document';
import { CompanyDetails, LegalSummary, Ph } from '@/components/storefront/legal-bits';
import { getShopDetails } from '@/lib/shop-details';
import { LEGAL_UPDATED } from '@/lib/legal';

/** See the other legal pages: reads live shop settings, so it must not be prerendered at build. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Repair terms & warranty' };

/**
 * What these terms say is matched to the repair booking form (components/storefront/repair):
 * an online booking is a REQUEST with an estimate and "pay nothing now — you pay after we've
 * diagnosed it and you've approved the price"; a person follows up to arrange next steps.
 *
 * Law behind it: Consumer Rights Act 2015 ss.49-57 (services: reasonable care and skill,
 * statements are binding, reasonable price and time, repeat performance / price reduction, and
 * none of that can be excluded); Consumer Contracts Regulations 2013 (14-day cancellation of
 * distance service contracts, early-start request, reg 36); and Scots common law for uncollected
 * goods (the Disposal of Uncollected Goods Act 1952 no longer applies, so the contract terms
 * and a reasonable-notice process do the work).
 */
export default async function RepairTermsPage() {
  const shop = await getShopDetails();

  return (
    <LegalDocument eyebrow="Legal" title="Repair terms & warranty" updated={LEGAL_UPDATED}>
      <p>
        These terms apply when you ask us to repair a device, whether you book on this website,
        phone us or call in. They are in addition to our <Link href="/terms">terms of sale</Link>{' '}
        (which cover anything you buy from us) and they do not affect your legal rights.
      </p>

      <LegalSummary>
        <p>
          An online booking is a request. We give you an estimate, confirm the price after we have
          looked at the device, and <strong>don&rsquo;t start until you have said yes</strong>.
        </p>
        <p>
          We do the work with reasonable care and skill. If we don&rsquo;t, we will put it right or
          reduce the price.
        </p>
        <p>
          Repairs carry a warranty for the part and our work, shown on your quote and receipt. Back
          your phone up before you hand it over.
        </p>
      </LegalSummary>

      <LegalSection title="Who we are">
        <CompanyDetails
          address={shop.shopAddress}
          email={shop.shopEmail}
          phone={shop.shopPhone}
          heading={false}
        />
      </LegalSection>

      <LegalSection title="How a repair works">
        <ol className="space-y-2 [&>li]:!list-decimal">
          <li>
            <strong>You ask.</strong> You tell us the device and the fault, choose a part grade, and
            give us your contact details. The price you see online is an <strong>estimate</strong>,
            based on what you have told us. Pay nothing at this stage.
          </li>
          <li>
            <strong>We contact you</strong> by the method you chose to arrange how the device gets
            to us (in person or by post) and when.
          </li>
          <li>
            <strong>We look at it.</strong> Once we have the device we diagnose it and confirm the
            price and timescale with you. <Ph name="DIAGNOSIS_FEE_POLICY" />
          </li>
          <li>
            <strong>You decide.</strong> We only go ahead once you have accepted the price. If we
            find something different from what you described, we tell you before we do any extra
            work or charge any more, and you can say no.
          </li>
          <li>
            <strong>We repair it, test it and tell you when it is ready.</strong> You pay when you
            collect it, or as we arrange with you if it is being posted back.
          </li>
        </ol>
        <p>
          What we tell you about the repair &mdash; price, parts, timescale, warranty &mdash; is
          part of your contract with us.
        </p>
      </LegalSection>

      <LegalSection title="Our standard of work">
        <p>
          We carry out every repair with reasonable care and skill, within a reasonable time (unless
          we agree a date) and for a reasonable price (the one we agreed). If we don&rsquo;t, you
          are entitled by law to ask us to repeat the work at no cost to you, and if we can&rsquo;t
          or don&rsquo;t put it right within a reasonable time, to a reduction in the price, which
          can be up to the full price. Refunds are made to the way you paid, within 14 days.
        </p>
      </LegalSection>

      <LegalSection title="Parts">
        <p>
          We offer parts in different grades, such as original, OEM and copy. Each grade is
          described when you choose it, together with its warranty. We use the grade you chose. If
          the part you chose is not available, we will tell you and agree an alternative before
          going ahead. Parts we replace become ours unless you ask for them back when you book.
        </p>
      </LegalSection>

      <LegalSection title="Repair warranty">
        <ul>
          <li>
            The warranty <strong>period depends on the part grade</strong> you chose. It is shown
            when you pick the grade, on your quote and on your receipt.
          </li>
          <li>
            It covers the <strong>part we fitted and our work</strong>. If the repaired part fails
            during the warranty because of the part or our work, bring it back and we will fix it
            free.
          </li>
          <li>
            It does <strong>not</strong> cover new damage after you collect the device &mdash; for
            example drops, cracks, liquid damage or bending &mdash; or a device that has been opened
            or worked on by someone else afterwards.
          </li>
          <li>
            It is on top of your legal rights, not instead of them. If a repair was not done with
            reasonable care and skill, your rights above apply whatever the warranty says.
          </li>
          <li>
            To claim, bring the device and your receipt or reference to the shop or contact us.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Things to know about repairs">
        <ul>
          <li>
            Opening a phone can reveal damage that was not visible before, and some repairs can
            reduce water resistance or, for older devices, cause other parts to fail. We will tell
            you the risks we know about before we start.
          </li>
          <li>
            A repair can lose data on the device.{' '}
            <strong>Back it up before you hand it over</strong>. We take care, but we cannot promise
            your data will be safe, and we are not responsible for data you could have backed up.
          </li>
          <li>
            Turn off any &ldquo;Find my device&rdquo; or account lock that stops the phone being
            tested, and tell us if the screen is locked &mdash; some repairs can&rsquo;t be tested
            without it.
          </li>
          <li>
            We may ask you to show you own the device or have the owner&rsquo;s permission. We will
            not repair a device we reasonably believe is stolen, and may tell the police.
          </li>
          <li>
            We do not change a device&rsquo;s IMEI or other identifying numbers; it is a criminal
            offence for anyone to do so without the manufacturer&rsquo;s authority.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Your data on the device">
        <p>
          Phones hold a lot of personal information. We only open or look at the content of your
          device &mdash; photos, messages, accounts &mdash; so far as is needed to test or complete
          the repair. We do not copy it or keep it. If we need your passcode to test the device, we
          will ask you, use it only for that, and not keep a record of it once the repair is
          finished. Our <Link href="/privacy">privacy notice</Link> explains how we handle the
          details you give us when you book.
        </p>
      </LegalSection>

      <LegalSection title="Cancelling a repair">
        <ul>
          <li>
            <strong>Before we start work</strong> you can change your mind at no cost. If you have
            posted the device, we will return it; <Ph name="REPAIR_RETURN_POSTAGE_POLICY" />.
          </li>
          <li>
            <strong>Your 14-day right.</strong> If you agree a repair with us online, by phone or by
            email, you have a legal right to cancel within 14 days of the day you agree it. You can
            use the form on our{' '}
            <Link href="/returns-policy#cancellation-form">returns &amp; cancellation</Link> page or
            any clear message.
          </li>
          <li>
            <strong>If you want us to start within those 14 days</strong> we will ask you to tell us
            so, in writing. If you then cancel, you pay for the work already done, in proportion to
            the whole job. If we have finished the repair at your request and you accepted that you
            would lose the right to cancel once it was done, the right ends when the repair is
            complete.
          </li>
          <li>
            If we have not told you about your right to cancel and the cost of work done, you will
            not have to pay for work done in the cancellation period.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Collecting your device">
        <p>
          We will tell you when your device is ready. Please collect it, or tell us how you want it
          sent back, within <Ph name="UNCOLLECTED_NOTICE_DAYS" /> days. If you haven&rsquo;t, we
          will contact you again by every method you gave us, in writing, and explain what happens
          next.
        </p>
        <p>
          We will look after a device that is waiting for collection with reasonable care.{' '}
          <Ph name="STORAGE_FEE_STATEMENT" /> If we still cannot reach you and you have not
          collected the device after a further <Ph name="UNCOLLECTED_FINAL_NOTICE_DAYS" /> days from
          our last written notice, we may, as a last resort, sell, recycle or dispose of it. Before
          we do, we will make sure the device has been wiped of your personal data.
          <Ph name="UNCOLLECTED_PROCEEDS_STATEMENT" />
        </p>
        <p>
          This is under Scots law, which has no special statute for uncollected goods, so what we do
          depends on what we have told you here, on giving you reasonable notice, and on making real
          attempts to reach you. If your circumstances mean you can&rsquo;t collect on time, such as
          illness, contact us before the deadline and we will work something out.
        </p>
      </LegalSection>

      <LegalSection title="Our responsibility to you">
        <p>
          We are responsible for loss or damage that is a foreseeable result of us not taking
          reasonable care or breaking these terms, including damage to your device caused by our
          fault. We are not responsible for loss that was not foreseeable, for loss of data you
          could have backed up, for existing faults or hidden damage that were not caused by us, or
          for any business loss. Nothing in these terms limits our responsibility for death or
          personal injury caused by our negligence, for fraud, or for your rights to a repeat repair
          or price reduction, or anything else the law doesn&rsquo;t allow us to limit.
        </p>
      </LegalSection>

      <LegalSection title="If something goes wrong">
        <p>
          Tell us and we will try to put it right &mdash; see our{' '}
          <Link href="/complaints">complaints procedure</Link>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
