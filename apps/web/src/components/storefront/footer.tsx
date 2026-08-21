'use client';

import Link from 'next/link';
import { SOCIALS, LEGAL_LINKS } from '@/lib/site';
import { useShopDetails } from '@/lib/data/hooks';
import { addressLines, addressShort, groupedHours, telHref, mailtoHref } from '@/lib/data/types';
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
      <div className="footer__meta container">
        <span>© 2026 Fonology Ltd</span>
        <span>{shop?.shopEmail?.split('@')[1] ?? ''}</span>
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
  const { data: shop } = useShopDetails();
  return (
    <footer className="footer footer--slim">
      <div className="footer__meta container">
        <span>© 2026 Fonology Ltd</span>
        <span>
          <a href={telHref(shop?.shopPhone ?? null)} data-cursor>
            {shop?.shopPhone ?? ''}
          </a>
        </span>
        <span>{addressShort(shop?.shopAddress ?? null)}</span>
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
