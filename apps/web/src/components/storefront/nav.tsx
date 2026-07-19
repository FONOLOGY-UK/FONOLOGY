'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { EASE, gsap, registerGsap, ScrollTrigger } from '@/lib/gsap';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { useMagnetic } from '@/lib/hooks/use-magnetic';
import { NAV_ITEMS, CONTACT, MENU_META } from '@/lib/site';
import { useCartStore, selectItemCount } from '@/lib/stores/cart.store';
import { useSmoothScroll } from './smooth-scroll';
import { Spark } from './art';

export function Nav() {
  const pathname = usePathname();
  const { reduced, ready } = useEnvironment();
  const { stop, start } = useSmoothScroll();
  const count = useCartStore(selectItemCount);
  const openCart = useCartStore((s) => s.open);

  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const ctaRef = useMagnetic<HTMLAnchorElement>();
  const [menuOpen, setMenuOpen] = useState(false);

  const isRepair = pathname === '/repair';

  // Nav scrolled / hide-on-scroll-down (core.js).
  useEffect(() => {
    if (!ready) return;
    registerGsap();
    const nav = navRef.current;
    if (!nav) return;
    const st = ScrollTrigger.create({
      start: 8,
      end: 'max',
      onUpdate: (self) => {
        nav.classList.toggle('is-scrolled', self.scroll() > 8);
        if (
          self.scroll() > 420 &&
          self.direction === 1 &&
          !document.body.classList.contains('menu-open')
        ) {
          nav.classList.add('is-hidden');
        } else {
          nav.classList.remove('is-hidden');
        }
      },
      onLeaveBack: () => nav.classList.remove('is-scrolled', 'is-hidden'),
    });
    return () => st.kill();
  }, [ready]);

  // Cart count bump when it changes.
  const prevCount = useRef(count);
  useEffect(() => {
    if (count !== prevCount.current && countRef.current) {
      const el = countRef.current;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
    prevCount.current = count;
  }, [count]);

  // Menu open/close animation (core.js clip-path timeline).
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    document.body.classList.toggle('menu-open', menuOpen);
    const links = menu.querySelectorAll('.menu__link');
    const meta = menu.querySelector('.menu__meta');
    if (menuOpen) {
      stop();
      menu.setAttribute('aria-hidden', 'false');
      gsap
        .timeline()
        .set(menu, { visibility: 'visible' })
        .to(menu, { clipPath: 'inset(0% 0 0% 0)', duration: reduced ? 0 : 0.7, ease: EASE.inOut })
        .fromTo(
          links,
          { yPercent: 60, autoAlpha: 0 },
          { yPercent: 0, autoAlpha: 1, stagger: 0.07, duration: 0.6, ease: EASE.expo },
          '-=0.25',
        )
        .fromTo(meta, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.5 }, '-=0.4');
    } else {
      start();
      gsap
        .timeline({
          onComplete: () => {
            menu.style.visibility = 'hidden';
            menu.setAttribute('aria-hidden', 'true');
          },
        })
        .to(menu, {
          clipPath: 'inset(0 0 100% 0)',
          duration: reduced ? 0 : 0.55,
          ease: EASE.inOut,
        });
    }
  }, [menuOpen, reduced, stop, start]);

  // Close menu on route change + Escape.
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <header className="nav" id="nav" ref={navRef}>
        <Link className="nav__brand" href="/" aria-label="Fonology home">
          <Spark className="nav__spark" />
          <span className="nav__word">FONOLOGY</span>
        </Link>
        <nav className="nav__links" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav__link${pathname === item.href ? 'is-active' : ''}`}
              data-cursor
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="nav__actions">
          <button
            className="nav__cart"
            id="cartBtn"
            onClick={openCart}
            data-cursor
            aria-label="Open bag"
          >
            <span className="nav__cart-word">Bag</span>
            <span className="nav__cart-count" ref={countRef}>
              {count}
            </span>
          </button>
          {isRepair ? (
            <a href={CONTACT.phoneHref} className="btn btn--red btn--sm nav__cta" ref={ctaRef}>
              <span className="btn__label">{CONTACT.phone}</span>
            </a>
          ) : (
            <Link href="/repair" className="btn btn--red btn--sm nav__cta" ref={ctaRef}>
              <span className="btn__label">Start a repair</span>
            </Link>
          )}
          <button
            className={`nav__burger${menuOpen ? 'is-open' : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            <span />
            <span />
          </button>
        </div>
      </header>

      <div className="menu" id="menu" ref={menuRef} aria-hidden="true">
        <div className="menu__inner">
          <nav className="menu__links">
            {NAV_ITEMS.map((item, i) => (
              <Link key={item.href} href={item.href} className="menu__link">
                <span className="menu__no">{String(i + 1).padStart(2, '0')}</span>
                <span className="menu__word">{item.label}</span>
              </Link>
            ))}
          </nav>
          <div className="menu__meta">
            <p>
              {MENU_META.addressLines[0]}
              <br />
              {MENU_META.addressLines[1]}
            </p>
            <p>
              {MENU_META.hoursLine}
              <br />
              <a href={CONTACT.phoneHref}>{CONTACT.phone}</a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
