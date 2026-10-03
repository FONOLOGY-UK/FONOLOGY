import type { NextFunction, Request, Response } from 'express';

/**
 * Cost prices are margin data. Only people holding `costs.view` may READ them.
 *
 * The till and the inventory screens are built on endpoints that used to carry every product's
 * cost price to anyone with `pos.operate` or `inventory.manage`. Anyone may still WRITE a cost
 * (the person receiving stock knows what it cost) — they just can't read one back.
 */

export function canSeeCosts(req: Request): boolean {
  return req.user?.kind === 'staff' && (req.user.permissions?.includes('costs.view') ?? false);
}

/**
 * Replaces the value of every listed key, at any depth, with 0. Numbers stay numbers so the
 * screens' schemas still parse; a screen that wants to show "hidden" checks the permission.
 */
export function zeroKeys(value: unknown, keys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => zeroKeys(v, keys));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = keys.has(k) && typeof v === 'number' ? 0 : zeroKeys(v, keys);
    }
    return out;
  }
  return value;
}

/**
 * Middleware: for a signed-in member of staff WITHOUT `costs.view`, zero the named keys in every
 * JSON body this request sends. Mounted in front of the product, inventory and sale routes.
 */
export function hideCosts(...keys: string[]) {
  const hidden = new Set(keys);
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.kind === 'staff' && !canSeeCosts(req)) {
      const send = res.json.bind(res);
      res.json = (body: unknown) => send(zeroKeys(body, hidden));
    }
    next();
  };
}
