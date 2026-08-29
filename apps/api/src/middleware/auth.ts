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
