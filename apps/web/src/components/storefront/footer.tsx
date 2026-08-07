'use client';

import Link from 'next/link';
import { CONTACT, HOURS, SOCIALS, LEGAL_LINKS } from '@/lib/site';
import { useSmoothScroll } from './smooth-scroll';
import { FooterAuthLinks } from './account-menu';
import { Spark } from './art';

/**
 * Storefront footer — preserved exactly from the prototype (big FONOLOGY
 * wordmark, VISIT / HOURS / CONTACT columns, socials, back-to-top). Changes
 * per Phase 2: the "Design prototype — not a live store" line is removed (6.1),
 * and legal links are added (6.6).
 */
export function Footer() {
  const { scrollTo } = useSmoothScroll();

  return (
    <footer className="footer" id="footer">
      <div className="footer__grid container">
        <div className="footer__col footer__col--pitch">
          <Spark variant="red" className="footer__spark" />
          <p>The phone repair counter your phone hopes it ends up on. One shop, done properly.</p>
        </div>
        <div className="footer__col">
          <h4>Visit</h4>
          <p>
            {CONTACT.addressLines[0]}
            <br />
            {CONTACT.addressLines[1]}
            <br />
            {CONTACT.addressLines[2]}
          </p>
        </div>
        <div className="footer__col">
          <h4>Hours</h4>
          <p>
            {HOURS.map((h) => (
              <span key={h.day}>
                {h.day} — {h.time}
                <br />
              </span>
            ))}
          </p>
        </div>
        <div className="footer__col">
          <h4>Contact</h4>
          <p>
            <a href={CONTACT.phoneHref} data-cursor>
              {CONTACT.phone}
            </a>
            <br />
            <a href={CONTACT.emailHref} data-cursor>
              {CONTACT.email}
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
      <div className="footer__meta container">
        <span>© 2026 Fonology Ltd</span>
        <span>{CONTACT.email.split('@')[1]}</span>
        {LEGAL_LINKS.map((l) => (
          <Link key={l.href} href={l.href} data-cursor>
            {l.label}
          </Link>
        ))}
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
  return (
    <footer className="footer footer--slim">
      <div className="footer__meta container">
        <span>© 2026 Fonology Ltd</span>
        <span>
          <a href={CONTACT.phoneHref} data-cursor>
            {CONTACT.phone}
          </a>
        </span>
        <span>{CONTACT.addressShort}</span>
        {LEGAL_LINKS.map((l) => (
          <Link key={l.href} href={l.href} data-cursor>
            {l.label}
          </Link>
        ))}
        <FooterAuthLinks />
      </div>
    </footer>
  );
}
