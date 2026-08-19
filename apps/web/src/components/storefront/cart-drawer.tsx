'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { EASE, gsap } from '@/lib/gsap';
import { formatGBP, pounds } from '@/lib/data/types';
import { DELIVERY_OPTIONS } from '@/lib/config';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { useCartStore, selectItemCount, selectSubtotal } from '@/lib/stores/cart.store';
import { useProducts } from '@/lib/data/hooks/use-products';
import { PRODUCT_ART, Spark } from './art';
import { useSmoothScroll } from './smooth-scroll';

// Sourced from DELIVERY_OPTIONS so this can never drift from the PDP's own
// "from £x" hint again (that's the bug this fixes — see drawer__hint below).
// The `?? pounds(3.95)` fallback only matters if 'standard' is ever removed
// from DELIVERY_OPTIONS entirely, which the config's own typing prevents.
const standardDeliveryPrice =
  DELIVERY_OPTIONS.find((o) => o.id === 'standard')?.price ?? pounds(3.95);

/**
 * Cart drawer ("BAG") — behaviour preserved exactly from the prototype:
 * slide-in panel, per-line qty controls, subtotal, empty state. The Checkout
 * button now routes to the full-page checkout (Phase 2, 6.3) instead of the
 * prototype's modal.
 */
export function CartDrawer() {
  const router = useRouter();
  const { reduced, ready } = useEnvironment();
  const { stop, start } = useSmoothScroll();

  const isOpen = useCartStore((s) => s.isOpen);
  const close = useCartStore((s) => s.close);
  const lines = useCartStore((s) => s.lines);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const remove = useCartStore((s) => s.remove);
  const count = useCartStore(selectItemCount);
  const subtotal = useCartStore(selectSubtotal);

  // Product art lookup (art key per line) — cheap, cached by the query hook.
  const { data: products } = useProducts();
  const artFor = (productId: string) => products?.find((p) => p.id === productId)?.art;
  const tileFor = (productId: string) => products?.find((p) => p.id === productId)?.tile ?? 'bone';

  const veilRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  // Park off-screen on mount (core.js boot).
  useEffect(() => {
    const drawer = drawerRef.current;
    if (drawer) gsap.set(drawer, { x: (drawer.offsetWidth || 460) + 40 });
  }, []);

  // Open / close animation.
  useEffect(() => {
    const drawer = drawerRef.current;
    const veil = veilRef.current;
    if (!drawer || !veil) return;

    if (isOpen) {
      veil.hidden = false;
      requestAnimationFrame(() => veil.classList.add('is-on'));
      drawer.setAttribute('aria-hidden', 'false');
      drawer.removeAttribute('inert');
      stop();
      gsap.fromTo(
        drawer,
        { x: drawer.offsetWidth + 40 },
        { x: 0, duration: reduced ? 0 : 0.65, ease: EASE.expo },
      );
    } else {
      veil.classList.remove('is-on');
      drawer.setAttribute('aria-hidden', 'true');
      drawer.setAttribute('inert', '');
      if (firstRender.current) {
        veil.hidden = true;
        firstRender.current = false;
        return;
      }
      start();
      gsap.to(drawer, {
        x: drawer.offsetWidth + 40,
        duration: reduced ? 0 : 0.5,
        ease: 'power3.in',
        onComplete: () => {
          veil.hidden = true;
        },
      });
    }
  }, [isOpen, reduced, ready, stop, start]);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  const goCheckout = () => {
    close();
    router.push('/checkout');
  };

  return (
    <>
      <div className="drawer-veil" ref={veilRef} onClick={close} hidden />
      {/* `inert` keeps the closed drawer's buttons out of the tab order —
          an a11y attribute only, zero visual change (Lighthouse aria-hidden-focus). */}
      <aside className="drawer" ref={drawerRef} aria-hidden="true" inert aria-label="Shopping bag">
        <header className="drawer__head">
          <h3>
            Your bag <span className="drawer__count">{count}</span>
          </h3>
          <button className="drawer__close" onClick={close} data-cursor aria-label="Close bag">
            ✕
          </button>
        </header>

        <div className="drawer__body">
          {lines.length === 0 ? (
            <div className="drawer__empty">
              <Spark variant="red" />
              <strong>Bag’s empty.</strong>
              <span>The shelf isn’t — go have a look.</span>
            </div>
          ) : (
            lines.map((line) => {
              const art = artFor(line.productId);
              return (
                <div className="ditem" key={line.productId}>
                  <div
                    className={`ditem__tile pcard__tile--${tileFor(line.productId)}`}
                    dangerouslySetInnerHTML={{
                      __html: art ? (PRODUCT_ART[art] ?? '') : '',
                    }}
                  />
                  <div className="ditem__info">
                    <h4>{line.name}</h4>
                    <span>{line.sub}</span>
                    <span className="ditem__price">{formatGBP(line.unitPrice)}</span>
                  </div>
                  <div className="ditem__side">
                    <div className="ditem__qty">
                      <button
                        className="ditem__btn"
                        onClick={() => setQuantity(line.productId, line.quantity - 1)}
                        aria-label="Decrease"
                      >
                        −
                      </button>
                      <span className="ditem__num">{line.quantity}</span>
                      <button
                        className="ditem__btn"
                        onClick={() => setQuantity(line.productId, line.quantity + 1)}
                        aria-label="Increase"
                      >
                        +
                      </button>
                    </div>
                    <button className="ditem__remove" onClick={() => remove(line.productId)}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {lines.length > 0 ? (
          <footer className="drawer__foot">
            <div className="drawer__row">
              <span>Subtotal</span>
              <strong>{formatGBP(subtotal)}</strong>
            </div>
            <p className="drawer__hint">
              {/*
                "from £x", never a flat price — the real fee is postcode-derived
                and quoted by the server at checkout (delivery_rates); a fixed
                number here is a promise the basket may not keep. Matches the
                PDP's delivery-hint pattern (product-detail.tsx).
              */}
              Free click &amp; collect from the counter · delivery from{' '}
              {formatGBP(standardDeliveryPrice)}
            </p>
            <button className="btn btn--red btn--full" onClick={goCheckout}>
              <span className="btn__label">Checkout</span>
              <span className="btn__arrow" aria-hidden="true">
                →
              </span>
            </button>
          </footer>
        ) : null}
      </aside>
    </>
  );
}
