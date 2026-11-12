'use client';

import Link from 'next/link';
import { SOCIALS, LEGAL_LINKS } from '@/lib/site';
import { useShopDetails } from '@/lib/data/hooks';
import { addressLines, addressShort, groupedHours, telHref, mailtoHref } from '@/lib/data/types';
import {
  LEGAL_COMPANY_NUMBER,
  LEGAL_REGISTERED_IN,
  LEGAL_REGISTERED_OFFICE,
  LEGAL_TRADER_NAME,
} from '@/lib/legal';
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
  const shops = shop?.shops ?? [];

  return (
    <footer className="footer" id="footer">
      <div className="footer__grid container">
        <div className="footer__col footer__col--pitch">
          <FonologyMark className="footer__mark" title="Fonology" />
          <p>The phone repair counter your phone hopes it ends up on. One shop, done properly.</p>
        </div>
        <div className="footer__col">
          <h4>Visit</h4>
          {shops.length > 0 ? (
            shops.map((s) => (
              <p key={s.name} className="footer__shop">
                <strong className="footer__shop-name">{s.name}</strong>
                <br />
                {s.address}
                {s.phone ? (
                  <>
                    <br />
                    <a href={telHref(s.phone)} className="footer__shop-phone" data-cursor>
                      {s.phone}
                    </a>
                  </>
                ) : null}
              </p>
            ))
          ) : (
            <p>
              {lines.map((line, i) => (
                <span key={i}>
                  {line}
                  <br />
                </span>
              ))}
            </p>
          )}
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
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                data-cursor
                aria-label={`${s.label} (opens in a new tab)`}
              >
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
        {(shop?.shops ?? []).length > 0 ? (
          (shop?.shops ?? []).map((s) => (
            <span key={s.name}>
              {s.name}: {addressShort(s.address)}
            </span>
          ))
        ) : (
          <span>{addressShort(shop?.shopAddress ?? null)}</span>
        )}
        <FooterAuthLinks />
      </div>
    </footer>
  );
}

/**
 * Every legal and policy page, in one labelled block — the footer used to link only three. They open in
 * a new tab (the owner's call) so a customer reading terms mid-checkout or mid-booking keeps their place.
 */
function LegalLinks() {
  return (
    <nav className="footer__legal container" aria-label="Legal and policies">
      <ul>
        {LEGAL_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} target="_blank" rel="noopener" data-cursor>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The company disclosures a UK online trader has to show: registered name, number, registered
 * office and where registered.
 */
function CompanyLine() {
  return (
    <p className="footer__company container">
      {LEGAL_TRADER_NAME}, trading as Fonology, registered in {LEGAL_REGISTERED_IN}, company number{' '}
      {LEGAL_COMPANY_NUMBER}. Registered office: {LEGAL_REGISTERED_OFFICE}.
    </p>
  );
}
