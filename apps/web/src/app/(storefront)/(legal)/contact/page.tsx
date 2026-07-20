import type { Metadata } from 'next';
import { ContentPlaceholder } from '@/components/storefront/content-placeholder';
import { CONTACT, HOURS } from '@/lib/site';

export const metadata: Metadata = { title: 'Contact' };

export default function ContactPage() {
  return (
    <ContentPlaceholder
      eyebrow="Help"
      title="Contact us"
      note="Details below are from the prototype and pending client confirmation (CONTENT-TODO.md)."
    >
      <div className="grid gap-6 text-sm sm:grid-cols-2">
        <div>
          <p className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">Find us</p>
          <address className="text-ink-2 mt-2 not-italic leading-relaxed">
            {CONTACT.addressLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
          <p className="mt-3">
            <a href={CONTACT.phoneHref} className="text-ink hover:text-red font-semibold">
              {CONTACT.phone}
            </a>
            <br />
            <a href={CONTACT.emailHref} className="text-ink hover:text-red font-semibold">
              {CONTACT.email}
            </a>
          </p>
        </div>
        <div>
          <p className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">Hours</p>
          <ul className="mt-2 grid gap-1">
            {HOURS.map((h) => (
              <li key={h.day} className="text-ink-2 flex justify-between gap-6">
                <span>{h.day}</span>
                <span className="font-semibold">{h.time}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </ContentPlaceholder>
  );
}
