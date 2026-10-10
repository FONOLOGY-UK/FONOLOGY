import type { Request, Response } from 'express';
import { db } from './db.js';
import { isUuid } from './uuid.js';

/**
 * Which shop a staff request acts on — the one rule behind multi-shop.
 *
 *   READS   readShop(req)   a shop id = only that shop's rows; null = every shop.
 *     employee  always their own shop; `?shop=` is ignored. So is a PIN-switched till
 *               session of anyone: a till only ever shows its own shop.
 *     manager   `?shop=<id>` picks a shop, `?shop=all` means every shop; without it, their
 *               own shop (so an old client that sends nothing still sees what it always did).
 *     owner     the same as a manager.
 *
 *   WRITES  writeShop(req, res)   exactly one shop, or the response has been sent.
 *     employee  their own shop.
 *     manager   their own shop; naming another is refused (they read everywhere, write at home).
 *     owner     `?shop=` or `shopId` in the body, else the shop on their account; with
 *               none of those, a 400 asking which shop (admin must pick one explicitly).
 *
 * The shop is NEVER taken from a field an employee controls. Managers and owners may
 * name a shop, and writeShop checks it is a real, active one.
 */

function namedShop(req: Request): string | null {
  const fromQuery = typeof req.query.shop === 'string' ? req.query.shop : undefined;
  const body = req.body as { shopId?: unknown } | undefined;
  const fromBody = typeof body?.shopId === 'string' ? body.shopId : undefined;
  const value = fromQuery ?? fromBody;
  return value && isUuid(value) ? value : null;
}

/** The shop to filter a read by: an id, or null for "every shop". */
export function readShop(req: Request): string | null {
  const user = req.user;
  if (!user || user.kind !== 'staff') return null;
  if (user.staffRole === 'employee' || user.posOnly) return user.shopId ?? null;
  const query = typeof req.query.shop === 'string' ? req.query.shop : undefined;
  if (query === 'all') return null;
  if (query && isUuid(query)) return query;
  return user.shopId ?? null;
}

/** May this caller READ a row that belongs to `shopId`? */
export function canRead(req: Request, shopId: string): boolean {
  const scope = readShop(req);
  return scope === null || scope === shopId;
}

/** May this caller CHANGE a row that belongs to `shopId`? Owners may change any; others only their own. */
export function canWrite(req: Request, shopId: string): boolean {
  const user = req.user;
  if (!user || user.kind !== 'staff') return false;
  if (user.staffRole === 'owner' && !user.posOnly) return true;
  return user.shopId === shopId;
}

/** True when this caller may see more than one shop (owner / manager). */
export function seesAllShops(req: Request): boolean {
  return req.user?.kind === 'staff' && req.user.staffRole !== 'employee';
}

/**
 * The shop a write belongs to. Returns null AFTER sending the error response, so a
 * handler does `const shopId = await writeShop(req, res); if (!shopId) return;`.
 */
/** The one message a change made while "All shops" is selected gets. */
export const ALL_SHOPS_VIEW_ONLY_MESSAGE = 'Please select a specific shop first to make changes.';

export async function writeShop(req: Request, res: Response): Promise<string | null> {
  const user = req.user;
  if (!user || user.kind !== 'staff') {
    res.status(401).json({ error: 'Staff sign-in required.' });
    return null;
  }

  // An owner or manager whose switcher is on "All shops" has not chosen where a change goes.
  // Refused, not guessed: the alternative is a product or a payment landing in their own shop
  // while the screen says "all".
  if (user.staffRole !== 'employee' && req.query.shop === 'all') {
    res.status(403).json({ error: ALL_SHOPS_VIEW_ONLY_MESSAGE });
    return null;
  }

  const named = namedShop(req);
  let shopId: string | null;

  if (user.staffRole === 'employee') {
    shopId = user.shopId ?? null;
  } else if (user.staffRole === 'manager') {
    if (named && named !== user.shopId) {
      res.status(403).json({ error: 'Managers can only make changes in their own shop.' });
      return null;
    }
    shopId = user.shopId ?? null;
  } else {
    shopId = named ?? user.shopId ?? null;
  }

  if (!shopId) {
    res.status(400).json({
      error:
        user.staffRole === 'owner'
          ? 'Choose which shop this is for.'
          : 'Your account is not assigned to a shop. Ask the owner to assign one.',
    });
    return null;
  }

  const shop = await db
    .selectFrom('shops')
    .select('id')
    .where('id', '=', shopId)
    .where('is_active', '=', true)
    .executeTakeFirst();
  if (!shop) {
    res.status(400).json({ error: 'That shop does not exist or is closed.' });
    return null;
  }
  return shopId;
}

/**
 * The shop a signed-in staff member works at the till in (for DB functions that take the
 * cashier and derive the shop themselves). Same answer as writeShop, without a body/query
 * override: a till is where the person is assigned.
 */
export function tillShop(req: Request): string | null {
  return req.user?.kind === 'staff' ? (req.user.shopId ?? null) : null;
}

/* ---------------------------------------------------------------------- */

let hubCache: { id: string; at: number } | null = null;

/**
 * The fulfilment hub (Shop 1): where online orders, repairs and trade-ins land, and —
 * until the master list exists — the only shop whose products the public site sells.
 * Cached briefly; it changes only when the owner moves the hub.
 */
export async function hubShopId(): Promise<string> {
  if (hubCache && Date.now() - hubCache.at < 60_000) return hubCache.id;
  const row = await db
    .selectFrom('shops')
    .select('id')
    .where('is_fulfilment_hub', '=', true)
    .executeTakeFirstOrThrow();
  hubCache = { id: row.id, at: Date.now() };
  return row.id;
}
