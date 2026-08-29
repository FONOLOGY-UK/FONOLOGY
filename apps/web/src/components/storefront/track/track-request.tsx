'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Package, Truck } from 'lucide-react';
import { useOrderTracking } from '@/lib/data/hooks/use-tracking';
import { LineMaskHeading } from '@/components/storefront/reveal';

/**
 * Round 5 Phase 3 #23 — rewritten. Was reference + email, resolving to a
 * booking, order or sell request with a full internal status timeline;
 * now Order ID only, orders only, and the result is just courier name +
 * tracking number. See the security-tradeoff discussion this shipped
 * with: dropping the email pairing on a sequential, guessable reference
 * is mitigated by this response being almost nothing on its own (no
 * address, name, phone or order contents) plus rate limiting on the API
 * route itself (GET /orders/:reference/tracking).
 *
 * Repair and sell-request tracking no longer live here — Phase 1 #32
 * already established tracking as purchases-only; a signed-in customer's
 * own repair/order history is the account dashboard (#22) instead.
 */
export function TrackRequest() {
  const params = useSearchParams();
  const router = useRouter();
  const initialRef = params.get('ref') ?? '';
  const [value, setValue] = useState(initialRef);
  const [submittedRef, setSubmittedRef] = useState(initialRef);

  useEffect(() => {
    setValue(initialRef);
    setSubmittedRef(initialRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRef]);

  const { data, isFetching, isError } = useOrderTracking(submittedRef);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ref = value.trim().toUpperCase();
    setSubmittedRef(ref);
    router.replace(ref ? `/track?ref=${encodeURIComponent(ref)}` : '/track', { scroll: false });
  };

  const canSubmit = value.trim().length > 0;
  const submitted = submittedRef.length > 0;

  return (
    <section className="track">
      <div className="container">
        <div className="track__head">
          <p className="eyebrow">Track it</p>
          <LineMaskHeading
            as="h1"
            className="track__title"
            immediate
            lines={['Where’s my', <em key="e">order?</em>]}
          />
          <p className="track__sub">
            Pop in your Order ID from your confirmation email and we’ll show you the courier and
            tracking number.
          </p>
          <form className="track__form" onSubmit={onSubmit}>
            <input
              type="text"
              placeholder="FNL-1234"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="Order ID"
            />
            <button type="submit" className="btn btn--red" disabled={!canSubmit}>
              <span className="btn__label">Track</span>
              <span className="btn__arrow" aria-hidden="true">
                →
              </span>
            </button>
          </form>
        </div>

        {submitted && isFetching ? <p className="track__msg">Looking that up…</p> : null}
        {submitted && !isFetching && (isError || data === null) ? (
          <p className="track__msg">
            We couldn’t find an order with ID <strong>{submittedRef}</strong>. Check the ID from
            your confirmation email and try again.
          </p>
        ) : null}
        {submitted && !isFetching && data ? <TrackingResultCard data={data} /> : null}
      </div>
    </section>
  );
}

function TrackingResultCard({
  data,
}: {
  data: { courier: string | null; trackingNumber: string | null };
}) {
  const shipped = data.courier && data.trackingNumber;
  return (
    <div className="track__result">
      <div className="track__result-head">
        <div className="track__kind">
          <Package
            className="size-4"
            aria-hidden="true"
            style={{ display: 'inline', marginRight: 6 }}
          />
          Order tracking
        </div>
      </div>
      {shipped ? (
        <div className="track__rows">
          <div className="track__row">
            <span>
              <Truck
                className="size-4"
                aria-hidden="true"
                style={{ display: 'inline', marginRight: 6 }}
              />
              Courier
            </span>
            <strong>{data.courier}</strong>
          </div>
          <div className="track__row">
            <span>Tracking number</span>
            <strong>{data.trackingNumber}</strong>
          </div>
        </div>
      ) : (
        <p className="track__msg" style={{ padding: '20px 0', textAlign: 'left' }}>
          Not shipped yet — a courier and tracking number will show here once it’s on its way.
        </p>
      )}
    </div>
  );
}
