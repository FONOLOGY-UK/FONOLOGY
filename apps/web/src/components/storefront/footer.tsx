'use client';

import Link from 'next/link';
import { SOCIALS, LEGAL_LINKS } from '@/lib/site';
import { useShopDetails } from '@/lib/data/hooks';
import { addressLines, addressShort, groupedHours, telHref, mailtoHref } from '@/lib/data/types';
import { LEGAL_TRADER_NAME } from '@/lib/legal';
import { Ph } from './legal-bits';
import { useSmoothScroll } from './smooth-scroll';
import { FooterAuthLinks } from './account-menu';
import { FonologyMark } from './art';

/**
 * Storefront footer — preserved exactly from the prototype (big FONOLOGY
 * wordmark, VISIT / HOURS / CONTACT columns, socials, back-to-top). Changes
 * per Phase 2: the "Design prototype — not a live store" line is removed (6.1),
 * and legal links are added (6.6).
 */
export function Footer() {
  const { scrollTo } = useSmoothScroll();
  const { data: shop } = useShopDetails();
  const lines = addressLines(shop?.shopAddress ?? null);
  const hours = groupedHours(shop?.openingHours ?? []);

  return (
    <footer className="footer" id="footer">
      <div className="footer__grid container">
        <div className="footer__col footer__col--pitch">
          <FonologyMark className="footer__mark" title="Fonology" />
          <p>The phone repair counter your phone hopes it ends up on. One shop, done properly.</p>
        </div>
        <div className="footer__col">
          <h4>Visit</h4>
          <p>
            {lines.map((line, i) => (
              <span key={i}>
                {line}
                <br />
              </span>
            ))}
          </p>
        </div>
        <div className="footer__col">
          <h4>Hours</h4>
          <p>
            {hours.map((h) => (
              <span key={h.days}>
                {h.days} — {h.time}
                <br />
              </span>
            ))}
          </p>
        </div>
        <div className="footer__col">
          <h4>Contact</h4>
          <p>
            <a href={telHref(shop?.shopPhone ?? null)} data-cursor>
              {shop?.shopPhone ?? ''}
            </a>
            <br />
            <a href={mailtoHref(shop?.shopEmail ?? null)} data-cursor>
              {shop?.shopEmail ?? ''}
            </a>
          </p>
          <div className="footer__socials">
            {SOCIALS.map((s) => (
              <a key={s.label} href={s.href} data-cursor aria-label={s.label}>
                {s.label}
              </a>
            ))}
          </div>
        </div>
      </div>
      <div className="footer__wordmark" aria-hidden="true">
        {'FONOLOGY'.split('').map((c, i) => (
          <span key={i}>{c}</span>
        ))}
      </div>
      <LegalLinks />
      <CompanyLine />
      <div className="footer__meta container">
        <span>© 2026 {LEGAL_TRADER_NAME}</span>
        <span>{shop?.shopEmail?.split('@')[1] ?? ''}</span>
        <FooterAuthLinks />
        <button className="footer__top" onClick={() => scrollTo(0)} data-cursor>
          Back to top ↑
        </button>
      </div>
    </footer>
  );
}

/**
 * Slim footer — used by the repair flow (from repair.html). "Design prototype"
 * line removed (6.1); legal links added (6.6).
 */
export function SlimFooter() {
  const { data: shop } = useShopDetails();
  return (
    <footer className="footer footer--slim">
      <LegalLinks />
      <CompanyLine />
      <div className="footer__meta container">
        <span>© 2026 {LEGAL_TRADER_NAME}</span>
        <span>
          <a href={telHref(shop?.shopPhone ?? null)} data-cursor>
            {shop?.shopPhone ?? ''}
          </a>
        </span>
        <span>{addressShort(shop?.shopAddress ?? null)}</span>
        <FooterAuthLinks />
      </div>
    </footer>
  );
}

/** Every legal and policy page, in one labelled block — the footer used to link only three. */
function LegalLinks() {
  return (
    <nav className="footer__legal container" aria-label="Legal and policies">
      <ul>
        {LEGAL_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} data-cursor>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The company disclosures a UK online trader has to show (registered name, number, registered
 * office, where registered) plus the ICO registration. The placeholders are the owner's to fill;
 * they render highlighted so they can't ship unnoticed.
 */
function CompanyLine() {
  return (
    <p className="footer__company container">
      {LEGAL_TRADER_NAME}, registered in <Ph name="REGISTERED_IN" />, company number{' '}
      <Ph name="COMPANY_NUMBER" />. Registered office: <Ph name="REGISTERED_OFFICE" />. ICO
      registration: <Ph name="ICO_REGISTRATION_NUMBER" />.
    </p>
  );
}
