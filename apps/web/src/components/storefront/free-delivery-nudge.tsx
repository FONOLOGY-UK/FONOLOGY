'use client';

import { formatGBP, type Money } from '@/lib/data/types';
import { useShopDetails } from '@/lib/data/hooks';

/**
 * "Spend £x more for free delivery" under a bag subtotal (0102).
 *
 * Display only. The threshold comes from GET /shop and the bag's subtotal is the browser's
 * own sum — the real fee is decided by delivery_quote() at checkout, which prices each line at
 * the server's price. Free means MORE than the threshold: at exactly £50.00 delivery is still
 * charged, so the "to go" copy never says £0.
 */
export function FreeDeliveryNudge({
  subtotal,
  className,
}: {
  subtotal: Money;
  className?: string;
}) {
  const { data: shop } = useShopDetails();
  const threshold = shop?.freeDeliveryThreshold;
  if (threshold == null) return null;

  const qualifies = subtotal > threshold;
  const progress = Math.min(subtotal / Math.max(threshold, 1), 1);
  const gap = threshold - subtotal;

  return (
    <div className={['fd-nudge', qualifies ? 'is-free' : '', className ?? ''].join(' ').trim()}>
      <p className="fd-nudge__text">
        {qualifies ? (
          <>Free standard delivery — UK mainland</>
        ) : (
          <>
            Free UK mainland delivery on orders over {formatGBP(threshold)}
            <span className="fd-nudge__gap">
              {gap > 0
                ? ` · ${formatGBP(gap, { alwaysShowPennies: true })} to go`
                : ' · add anything to qualify'}
            </span>
          </>
        )}
      </p>
      <div className="fd-nudge__track" aria-hidden="true">
        <span className="fd-nudge__bar" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </div>
  );
}
