import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

/**
 * Print-agent authentication.
 * =========================================================================
 * Until now this API has only ever authenticated PEOPLE — a Supabase session
 * cookie resolved to a staff or customer row (lib/session.ts). The print agent
 * is a device: an unattended process on a shop PC in Glasgow that nobody signs
 * into.
 *
 * So it gets its own credential, and a deliberately feeble one. An agent token
 * reaches ONLY the endpoints mounted behind `requireAgent` — it cannot read a
 * product, a sale, or a customer, and it cannot act as staff. That restraint is
 * the point: this token lives in a config file on a machine behind a shop
 * counter that anyone can walk up to. Assume it will leak eventually, and make
 * leaking it boring.
 *
 * WHY SHA-256 AND NOT BCRYPT
 * `password.ts` uses bcrypt, correctly, for 4-digit PINs — a slow hash is what
 * makes 10,000 combinations expensive to grind. An agent token is 32 random
 * bytes; there is nothing to grind. A fast hash is both sufficient and
 * necessary here, because we look the agent UP by hash, and you cannot look
 * anything up by a bcrypt hash. Same reasoning and same primitive as the
 * sell-request acceptance tokens in sell.routes.ts.
 *
 * The agent is attached as `req.agent`, never as `req.user`. Keeping them in
 * separate places means a handler cannot accidentally treat a printer as a
 * member of staff — `requireStaff` will still reject an agent outright.
 */

export interface ApiPrintAgent {
  id: string;
  name: string;
  isPrimary: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      agent?: ApiPrintAgent;
    }
  }
}

/** Hash a token for storage or lookup. Never store or log the token itself. */
export function hashAgentToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Issue a fresh token. Shown to the owner once and never recoverable after. */
export function generateAgentToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Rejects unless the caller presents a valid, non-revoked agent token.
 *
 * Does NOT require the agent to be primary — a non-primary agent must still be
 * able to authenticate so that it can heartbeat and therefore be VISIBLE in the
 * admin screen. That is what turns "someone quietly installed a second copy"
 * from an invisible double-printing bug into a row on a page. Leasing is where
 * primary is enforced (in `claim_print_job`, in the database, so it holds even
 * if a future endpoint forgets).
 */
export async function requireAgent(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'Print agent token required.' });
  }

  const { data: agent } = await supabaseAdmin
    .from('print_agents')
    .select('id, name, is_primary, revoked_at')
    .eq('token_hash', hashAgentToken(token))
    .maybeSingle();

  // One message for "no such token" and "revoked token" on purpose — telling
  // a caller which of the two it was tells them whether they have guessed a
  // real token.
  if (!agent || agent.revoked_at) {
    return res.status(401).json({ error: 'Print agent token is not valid.' });
  }

  req.agent = { id: agent.id, name: agent.name, isPrimary: agent.is_primary };
  next();
}
