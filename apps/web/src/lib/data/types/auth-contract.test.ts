import { describe, expect, it } from 'vitest';
import { authUserSchema } from './auth';

/**
 * THE CONTRACT THIS FILE EXISTS FOR
 *
 * `authUserSchema` is what the http adapter parses every staff session
 * through, and a failed parse does not degrade — it throws, the mutation
 * rejects, and every `onSuccess` behind it becomes dead code.
 *
 * That happened. `POST /staff/session/switch` (change request item 4) was
 * written by hand rather than through the same builder as the other two
 * staff sessions, and it left out `staffRole` — required here, nullable but
 * not optional. So the server switched the till, rewrote both auth cookies
 * and ended the outgoing session, and the browser treated the whole thing
 * as a failure: no cache clear, no reload, a stale name in the header over
 * a session that had already changed hands, and "That PIN wasn't right"
 * shown to someone whose PIN was right. Three attempted fixes went into a
 * callback that was never reached.
 *
 * Nothing typed that boundary and nothing could: the API's response and
 * this schema are compiled separately and never meet. So the bodies below
 * are held here literally, one per producer, and must be updated when the
 * API's are. If that sounds fragile, note what it replaces — nothing.
 *
 * The API side is now a single `staffAuthUser()` in apps/api/src/lib/
 * session.ts, so the three cannot silently diverge again, and
 * `apps/api/scripts/schema-audit.ts` proves the live responses against this
 * same schema. This file is the part that runs without a database.
 */

const BASE = {
  id: '00000000-0000-0000-0000-0000000000aa',
  name: 'Test Employee',
  email: 'employee@example.invalid',
  kind: 'staff' as const,
  staffRole: 'employee' as const,
  permissions: ['pos.operate'],
  staffSessionId: '00000000-0000-0000-0000-0000000000bb',
  idleLockMinutes: null,
};

/**
 * Each entry mirrors one `staffAuthUser(...)` call site, field for field as
 * that helper emits it. The name is the route, so a failure names the
 * endpoint to go and look at.
 */
const producers: Array<[string, unknown]> = [
  // apps/api/src/lib/session.ts — resolveSession(), behind GET /auth/session
  ['GET /auth/session', { ...BASE, locked: true, posOnly: false }],
  // apps/api/src/routes/staff.routes.ts — POST /staff/signin
  ['POST /staff/signin', { ...BASE, locked: false, posOnly: false }],
  // apps/api/src/routes/staff.routes.ts — POST /staff/session/switch
  ['POST /staff/session/switch', { ...BASE, locked: false, posOnly: true }],
];

describe('every staff AuthUser the API produces parses as one', () => {
  for (const [route, body] of producers) {
    it(`${route}`, () => {
      const result = authUserSchema.safeParse(body);
      expect(
        result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      ).toEqual([]);
    });
  }

  /**
   * The specific regression, called out on its own so a future failure
   * reads as the bug it is rather than as one row in a loop.
   */
  it('refuses a body with no staffRole — the exact shape that broke item 4', () => {
    const { staffRole: _omitted, ...withoutRole } = BASE;
    expect(authUserSchema.safeParse({ ...withoutRole, posOnly: true }).success).toBe(false);
  });
});
