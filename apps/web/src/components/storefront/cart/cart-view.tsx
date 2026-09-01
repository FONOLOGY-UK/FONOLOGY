'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatGBP } from '@/lib/data/types';
import { useCartStore, selectSubtotal, selectItemCount } from '@/lib/stores/cart.store';
import { FonologyMark } from '@/components/storefront/art';

/** Full-page bag (mirrors the drawer). Nav Bag still opens the drawer; this is
 *  the direct-URL / shareable view. */
export function CartView() {
  const router = useRouter();
  const lines = useCartStore((s) => s.lines);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const remove = useCartStore((s) => s.remove);
  const subtotal = useCartStore(selectSubtotal);
  const count = useCartStore(selectItemCount);

  if (lines.length === 0) {
    return (
      <section className="checkout-page">
        <div className="sf-empty container">
          <FonologyMark className="sf-empty__mark" />
          <strong className="font-display text-ink text-2xl font-extrabold uppercase">
            Your bag’s empty
          </strong>
          <p className="text-muted max-w-sm text-sm">The shelf isn’t — go have a look.</p>
          <Link href="/shop" className="btn btn--red">
            <span className="btn__label">Browse the shop</span>
            <span className="btn__arrow" aria-hidden="true">
              →
            </span>
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="checkout-page">
      <div className="container">
        <p className="eyebrow">Your bag</p>
        <h1 className="checkout-page__title">
          {count} item{count === 1 ? '' : 's'}.
        </h1>

        <div className="checkout-page__grid">
          <div className="co-panel">
            {lines.map((l) => (
              <div className="ditem" key={l.productId} style={{ gridTemplateColumns: '1fr auto' }}>
                <div className="ditem__info">
                  <h4>{l.name}</h4>
                  <span>{l.sub}</span>
                  <span className="ditem__price">{formatGBP(l.unitPrice)}</span>
                </div>
                <div className="ditem__side">
                  <div className="ditem__qty">
                    <button
                      className="ditem__btn"
                      onClick={() => setQuantity(l.productId, l.quantity - 1)}
                      aria-label="Decrease"
                    >
                      −
                    </button>
                    <span className="ditem__num">{l.quantity}</span>
                    <button
                      className="ditem__btn"
                      onClick={() => setQuantity(l.productId, l.quantity + 1)}
                      aria-label="Increase"
                    >
                      +
                    </button>
                  </div>
                  <button className="ditem__remove" onClick={() => remove(l.productId)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <aside className="co-summary">
            <h2 className="co-summary__title">Summary</h2>
            <div className="co-totals">
              <div className="co-totals__row">
                <span>Subtotal</span>
                <span>{formatGBP(subtotal)}</span>
              </div>
              <div className="co-totals__row co-totals__row--total">
                <span>Total</span>
                <strong>{formatGBP(subtotal)}</strong>
              </div>
            </div>
            {/* Round 4 #BUG-06 follow-up: click & collect isn't offered at
                checkout any more — don't advertise it here either. */}
            <p className="ck-note" style={{ marginTop: 12 }}>
              Delivery calculated at checkout.
            </p>
            <button
              className="btn btn--red btn--full"
              style={{ marginTop: 6 }}
              onClick={() => router.push('/checkout')}
            >
              <span className="btn__label">Checkout</span>
              <span className="btn__arrow" aria-hidden="true">
                →
              </span>
            </button>
            <Link className="co-back" href="/shop" style={{ display: 'inline-block' }}>
              ← Keep shopping
            </Link>
          </aside>
        </div>
      </div>
    </section>
  );
}
