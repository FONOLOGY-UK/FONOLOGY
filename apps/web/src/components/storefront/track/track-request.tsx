'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { TrackingResult } from '@/lib/data/types';
import { formatGBP } from '@/lib/data/types';
import { useTracking } from '@/lib/data/hooks/use-tracking';
import { useDevices, useRepairTypes } from '@/lib/data/hooks/use-repair';
import { LineMaskHeading } from '@/components/storefront/reveal';

interface Step {
  id: string;
  label: string;
}

function humanize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
}

function timelineFor(result: TrackingResult): {
  steps: Step[];
  current: number;
  status: string;
  cancelled: boolean;
} {
  if (result.kind === 'booking') {
    const steps: Step[] = [
      { id: 'received', label: 'Received' },
      { id: 'in-progress', label: 'In repair' },
      { id: 'ready', label: 'Ready' },
      { id: 'dispatched', label: 'Posted back' },
    ];
    return {
      steps,
      current: steps.findIndex((s) => s.id === result.booking.status),
      status: result.booking.status,
      cancelled: result.booking.status === 'cancelled',
    };
  }
  if (result.kind === 'sell') {
    const steps: Step[] = [
      { id: 'received', label: 'Received' },
      { id: 'quoted', label: 'Quote sent' },
      { id: 'accepted', label: 'Accepted' },
      { id: 'paid', label: 'Paid' },
    ];
    return {
      steps,
      current: steps.findIndex((s) => s.id === result.sell.status),
      status: result.sell.status,
      cancelled: result.sell.status === 'declined',
    };
  }
  const deliver = result.order.delivery !== 'collect';
  const steps: Step[] = deliver
    ? [
        { id: 'paid', label: 'Paid' },
        { id: 'shipped', label: 'Shipped' },
      ]
    : [
        { id: 'paid', label: 'Paid' },
        { id: 'ready', label: 'Ready' },
        { id: 'collected', label: 'Collected' },
      ];
  return {
    steps,
    current: steps.findIndex((s) => s.id === result.order.status),
    status: result.order.status,
    cancelled: result.order.status === 'cancelled',
  };
}

function ResultCard({ result }: { result: TrackingResult }) {
  const { data: devices } = useDevices();
  const { data: repairs } = useRepairTypes();
  const { steps, current, status, cancelled } = timelineFor(result);

  const kindLabel =
    result.kind === 'booking'
      ? 'Repair request'
      : result.kind === 'sell'
        ? 'Sell request'
        : 'Order';
  const reference =
    result.kind === 'booking'
      ? result.booking.reference
      : result.kind === 'sell'
        ? result.sell.reference
        : result.order.reference;

  return (
    <div className="track__result">
      <div className="track__result-head">
        <div>
          <div className="track__kind">{kindLabel}</div>
          <div className="track__ref">{reference}</div>
        </div>
        <span className={cancelled ? 'track__status-pill is-cancelled' : 'track__status-pill'}>
          {humanize(status)}
        </span>
      </div>

      {!cancelled ? (
        <div className="timeline">
          {steps.map((s, i) => {
            const cls = ['timeline__step', i <= current && 'is-done', i === current && 'is-active']
              .filter(Boolean)
              .join(' ');
            return (
              <div className={cls} key={s.id}>
                <span className="timeline__dot" />
                <span className="timeline__label">{s.label}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="track__rows">
        {result.kind === 'booking' ? (
          <>
            <div className="track__row">
              <span>Phone</span>
              <strong>{devices?.find((d) => d.id === result.booking.deviceId)?.name ?? '—'}</strong>
            </div>
            <div className="track__row">
              <span>Repair</span>
              <strong>{repairs?.find((r) => r.id === result.booking.repairId)?.name ?? '—'}</strong>
            </div>
            <div className="track__row">
              <span>Estimate</span>
              <strong>
                {result.booking.price != null ? formatGBP(result.booking.price) : 'Quote first'}
              </strong>
            </div>
          </>
        ) : result.kind === 'sell' ? (
          <>
            <div className="track__row">
              <span>Phone</span>
              <strong>{devices?.find((d) => d.id === result.sell.deviceId)?.name ?? '—'}</strong>
            </div>
            <div className="track__row">
              <span>Indicative estimate</span>
              <strong>
                {result.sell.estimate != null ? formatGBP(result.sell.estimate) : 'We’ll quote you'}
              </strong>
            </div>
          </>
        ) : (
          <>
            {result.order.lines.map((l) => (
              <div className="track__row" key={l.productId}>
                <span>
                  {l.name} × {l.quantity}
                </span>
                <strong>{formatGBP(l.unitPrice * l.quantity)}</strong>
              </div>
            ))}
            <div className="track__row">
              <span>{result.order.delivery === 'collect' ? 'Collection' : 'Delivery'}</span>
              <strong>
                {result.order.delivery === 'collect' ? 'Free' : formatGBP(result.order.deliveryFee)}
              </strong>
            </div>
            <div className="track__row">
              <span>Total</span>
              <strong>{formatGBP(result.order.total)}</strong>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function TrackRequest() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get('ref') ?? '';
  const [value, setValue] = useState(initial);
  const [submitted, setSubmitted] = useState(initial);

  useEffect(() => {
    setValue(initial);
    setSubmitted(initial);
  }, [initial]);

  const { data, isFetching, isError } = useTracking(submitted, submitted.trim().length > 0);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ref = value.trim().toUpperCase();
    setSubmitted(ref);
    const qs = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    router.replace(`/track${qs}`, { scroll: false });
  };

  return (
    <section className="track">
      <div className="container">
        <div className="track__head">
          <p className="eyebrow">Track it</p>
          <LineMaskHeading
            as="h1"
            className="track__title"
            immediate
            lines={['Where’s my', <em key="e">stuff?</em>]}
          />
          <p className="track__sub">
            Pop in the reference from your confirmation — repair, order or sell request — and we’ll
            show you exactly where it is.
          </p>
          <form className="track__form" onSubmit={onSubmit}>
            <input
              type="text"
              placeholder="FNL-1234"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="Reference number"
            />
            <button type="submit" className="btn btn--red">
              <span className="btn__label">Track</span>
              <span className="btn__arrow" aria-hidden="true">
                →
              </span>
            </button>
          </form>
          <p className="track__hint">Try FNL-2001 (repair), FNL-1001 (order) or FNL-3001 (sell).</p>
        </div>

        {submitted && isFetching ? <p className="track__msg">Looking that up…</p> : null}
        {submitted && !isFetching && (isError || data === null) ? (
          <p className="track__msg">
            We couldn’t find <strong>{submitted}</strong>. Check the reference and try again.
          </p>
        ) : null}
        {data ? <ResultCard result={data} /> : null}
      </div>
    </section>
  );
}
