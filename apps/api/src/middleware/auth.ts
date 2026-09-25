import type { NextFunction, Request, Response } from 'express';
import { resolveSession, type ApiAuthUser } from '../lib/session.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: ApiAuthUser;
    }
  }
}

/** Attaches req.user if a valid session exists. Never rejects — auth is optional here. */
export async function attachSession(req: Request, res: Response, next: NextFunction) {
  req.user = (await resolveSession(req, res)) ?? undefined;
  next();
}

/** Rejects unless the caller is a signed-in, active staff member. */
export function requireStaff(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.kind !== 'staff') {
    return res.status(401).json({ error: 'Staff sign-in required.' });
  }
  next();
}

/** Rejects unless the caller is a signed-in customer. */
export function requireCustomer(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.kind !== 'customer') {
    return res.status(401).json({ error: 'Sign-in required.' });
  }
  next();
}

/**
 * Rejects a locked till session — this is the enforcement point that makes
 * "reload can't bypass a locked till" true: lock state lives in
 * `staff_sessions` (server-side), checked fresh on every request via
 * resolveSession, not in anything the client holds or can forge.
 */
export function requireUnlocked(req: Request, res: Response, next: NextFunction) {
  if (req.user?.locked) {
    return res.status(423).json({ error: 'This session is locked. Enter the PIN to continue.' });
  }
  next();
}

/**
 * Refuses the admin surface to a session obtained by PIN-switching at the
 * till. Change request item 4's security restriction.
 *
 * "Fast PIN-switching ... cannot be used to access the Admin dashboard —
 * Admin access must always require a standard, full login." That cannot be
 * met by leaving the link off a screen: the API is reachable directly, and
 * this project's whole permission model rests on the UI gate never being the
 * real one. So the refusal is here, in front of the admin routers, and it
 * ignores permissions entirely — an OWNER who PIN-switches into the till
 * gets the till.
 *
 * 403 with a sentence that says what to do, not 401: the person IS
 * authenticated, they are simply not authenticated the way Admin requires.
 */
/**
 * The admin READS the till itself is built on, which a PIN-switched session
 * must still reach.
 *
 * Found by real-browser testing on staging: after a PIN switch the header
 * correctly showed the incoming person — and the till's product grid was
 * EMPTY. The till reads its catalogue from GET /admin/products, and this
 * middleware refused everything under /admin. So item 4 switched accounts
 * and left the new person unable to ring anything up, while its own test
 * passed by asserting that very 403 as the security property.
 *
 * "Cannot be used to access the Admin dashboard" means the dashboard — its
 * settings, its staff, its reports, its editing. It never meant the till's
 * own catalogue, which only happens to live under /admin. Established by
 * diffing every call the till pages make as a PIN-switched employee against
 * the same employee signed in with a password: exactly these were refused
 * only because of the switch.
 *
 *   /products                  the till grid
 *   /products/barcode/:code    the scanner
 *   /products/:id/variants     choosing a variant at the till
 *   /promotions                bulk-deal pricing on the ticket
 *   /categories                category filtering
 *   /inventory/summary         the till's inventory tab
 *
 * GET ONLY, and each route still runs its own requirePermission after this,
 * so a PIN session reaches exactly what the same person would see on the
 * till after a full sign-in — never more. Every write under /admin, and
 * every other read, stays refused.
 */
const POS_ONLY_ALLOWED_ADMIN_READS: RegExp[] = [
  /^\/products\/?$/,
  /^\/products\/barcode\/[^/]+\/?$/,
  /^\/products\/[0-9a-f-]{36}\/variants\/?$/,
  /^\/promotions\/?$/,
  /^\/categories\/?$/,
  /^\/inventory\/summary\/?$/,
];

export function blockPosOnlySession(req: Request, res: Response, next: NextFunction) {
  if (req.user?.kind === 'staff' && req.user.posOnly) {
    const tillRead =
      req.method === 'GET' &&
      req.baseUrl === '/admin' &&
      POS_ONLY_ALLOWED_ADMIN_READS.some((re) => re.test(req.path));
    if (tillRead) return next();
    return res.status(403).json({
      error:
        'This till session was unlocked with a PIN. Sign in with your email and password to use the dashboard.',
    });
  }
  next();
}

/**
 * Blocks a signed-in staff/owner session from completing a customer-facing
 * submission — placing an order, booking a repair, or submitting a sell-in
 * request. These routes are deliberately open to anyone with no sign-in at
 * all (guest checkout is a hard business rule — see CLAUDE.md), which is
 * exactly why a staff session used to slip through: nothing distinguished
 * "no session" from "a staff session" and both fell through to the same
 * open path. A till account completing a customer order is not the same
 * as a guest — the enforcement point that was missing.
 *
 * `verb` customises the message per flow ("place an order" / "book a
 * repair" / "submit a sell-in request"), all landing on the client-facing
 * wording the report asked for: "Cannot ... while signed in as staff."
 */
export function blockStaffCheckout(verb: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.kind === 'staff') {
      return res.status(403).json({
        error: `Cannot ${verb} while signed in as staff. Sign out, or use a private window, to continue as a customer.`,
      });
    }
    next();
  };
}

/**
 * Requires the caller to hold a specific permission, checked against the
 * per-person set loaded from `staff_permissions` at session-resolution time
 * — never against the mapped UI `staffRole`, which is display-only.
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (
      !req.user ||
      req.user.kind !== 'staff' ||
      !req.user.permissions?.includes(permission as never)
    ) {
      return res.status(403).json({ error: `Missing permission: ${permission}` });
    }
    next();
  };
}
