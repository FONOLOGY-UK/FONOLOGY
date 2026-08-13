import { z } from 'zod';

/**
 * The shop's own details, for the top of a receipt.
 * =========================================================================
 * WHY THIS IS FETCHED AND NOT WRITTEN INTO THE RENDERER
 * The first draft of receipt.ts printed the address and phone number as string
 * literals. That was wrong, and specifically wrong in a way this project had
 * already paid to fix once: `GET /shop` exists because the storefront "carried
 * five separate hardcoded copies" of these facts (see the header of
 * apps/api/src/routes/shop.routes.ts), and hardcoding them here would simply
 * have added a sixth — the one furthest from anybody who could correct it.
 *
 * The cost of getting this wrong is concrete. The shop changes its phone
 * number, the owner updates it in settings, every screen follows — and the
 * receipt keeps printing the old number until someone rebuilds the bundle and
 * reinstalls it on a PC in Glasgow.
 *
 * That same endpoint header calls out the till explicitly: counter staff hold
 * `pos.operate` but not `settings.manage`, which is why these facts were made
 * public rather than left behind an admin permission. The agent is the thing
 * that actually prints them.
 *
 * Schema written against the endpoint's RESPONSE BUILDER, not the table: it
 * reshapes snake_case columns into camelCase and drops several fields.
 * Verified against apps/api/src/routes/shop.routes.ts and the dev project.
 */
export const shopDetailsSchema = z.object({
  shopName: z.string().nullable(),
  shopAddress: z.string().nullable(),
  shopPhone: z.string().nullable(),
  shopEmail: z.string().nullable(),
  /** Printed above the reference. Null in dev today. */
  receiptHeaderText: z.string().nullable(),
  /** The warranty wording. Real, and already set in dev. */
  receiptFooterText: z.string().nullable(),
  returnWindowDays: z.number().int().nullable(),
});
export type ShopDetails = z.infer<typeof shopDetailsSchema>;

/**
 * "61c Main Street, Thornliebank, Glasgow, G46 7RX" → the parts, for stacking
 * over several lines.
 *
 * Deliberately identical in behaviour to `addressLines()` in
 * apps/web/src/lib/data/types/shop.ts. Splitting rather than storing separate
 * columns keeps one editable field in settings — an owner types their address
 * the way they would write it.
 */
export function addressLines(address: string | null): string[] {
  if (!address) return [];
  return address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * What to print when `/shop` cannot be reached.
 *
 * Empty rather than invented. A receipt with no address is obviously
 * incomplete; a receipt with a WRONG address is a document the customer can
 * hold the shop to. The name is the one exception — the shop is called
 * Fonology, that is client-confirmed, and a receipt with no name at all is not
 * recognisably a receipt.
 */
export function fallbackShopDetails(): ShopDetails {
  return {
    shopName: 'Fonology',
    shopAddress: null,
    shopPhone: null,
    shopEmail: null,
    receiptHeaderText: null,
    receiptFooterText: null,
    returnWindowDays: null,
  };
}
