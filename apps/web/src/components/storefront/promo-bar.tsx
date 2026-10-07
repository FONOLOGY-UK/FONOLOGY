import { formatGBP } from '@/lib/data/types';
import type { ServerShopDetails } from '@/lib/shop-details';

/**
 * The site-wide free-delivery strip above the nav (0102). Fixed, so it stays put while the nav
 * hides on scroll; the layout sets --promo-h whenever it renders, which pushes the nav and the
 * page down by its height (storefront-extend.css).
 *
 * Renders nothing when the threshold is unknown (API unreachable at revalidate time) — no
 * promise the shop may not keep.
 */
export function PromoBar({ shop }: { shop: ServerShopDetails }) {
  if (shop.freeDeliveryThreshold == null) return null;
  return (
    <div className="promo-bar" role="note">
      <span className="promo-bar__text">
        Free UK mainland delivery on orders over {formatGBP(shop.freeDeliveryThreshold)}
      </span>
    </div>
  );
}
