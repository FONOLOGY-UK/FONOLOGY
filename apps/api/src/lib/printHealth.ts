/**
 * Is the print agent actually in trouble, or is the shop just shut?
 * =========================================================================
 * The admin screen has one job here: tell a real problem from a normal one.
 * Without that distinction it is a screen nobody trusts — a red "PRINTER DOWN"
 * banner every night from 19:00 to 09:30 trains the owner to ignore the banner,
 * and then it is still being ignored on the Saturday it means something.
 *
 * So an agent that has not been heard from is `asleep` outside opening hours
 * and `down` inside them. Same silence, different meaning, and the difference
 * comes from `shop_settings.opening_hours` — the owner's own trading hours, so
 * it stays correct when they change them rather than needing a code change.
 *
 * WHY THIS IS COMPUTED ON THE SERVER
 * Two reasons, both of which have bitten this project in other forms:
 *
 *   1. The browser's clock and timezone belong to whoever is looking at the
 *      screen. An owner checking from a phone abroad must not see the shop as
 *      open because it is 11am where they are standing.
 *   2. The till PC's clock is not trustworthy either — that is exactly why the
 *      print agent pins its own timestamps to Europe/London rather than using
 *      the host clock (see the agent's sanitise.ts, where a UTC+5 machine
 *      printed a 15:03Z sale as 20:03).
 *
 * Europe/London throughout, so BST is handled by the IANA database rather than
 * by a rule written here.
 */

/** How the health of one agent reads on the admin screen. */
export type AgentHealth =
  /** Heartbeat within the expected window. */
  | 'ok'
  /** Late, but not long enough to call it down. The shop is open. */
  | 'stale'
  /** Silent, and the shop is shut. Expected, not a fault. */
  | 'asleep'
  /** Silent while the shop is open. This is the one that matters. */
  | 'down'
  /** Registered but has never once checked in — almost always a bad token. */
  | 'never_seen';

/**
 * The agent heartbeats every 30 seconds (heartbeat.ts INTERVAL_MS).
 *
 * `stale` at 3 missed beats and `down` at 10 rather than tripping on the first:
 * a single missed heartbeat is a slow round trip to Germany, not a dead till,
 * and a screen that flickers red on ordinary jitter is a screen that gets
 * ignored. Five minutes of silence during trading hours is genuinely wrong.
 */
const STALE_AFTER_MS = 90_000;
const DOWN_AFTER_MS = 300_000;

export interface OpeningHoursEntry {
  /** 'Mon' … 'Sun', as seeded by migration 0034. */
  day?: string | null;
  /** 'HH:MM' 24-hour wall clock, Europe/London. */
  open?: string | null;
  close?: string | null;
  closed?: boolean | null;
}

/** Index 0 = Sunday, matching the order `Intl` weekday lookups are mapped to. */
const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * The shop's own wall clock: weekday and minutes-since-midnight in London.
 *
 * Built from `formatToParts` rather than string parsing, because the assembled
 * form of `en-GB` has changed between ICU versions and this must not depend on
 * a separator.
 */
function londonNow(now: Date): { dayKey: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  // 'Mon' from en-GB short weekday. Normalised to the three-letter form the
  // settings row uses, because some ICU builds render "Mon" and others "Mon.".
  const dayKey = get('weekday').replace(/\W/g, '').slice(0, 3);
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return { dayKey, minutes };
}

function toMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Is the shop open right now?
 *
 * UNKNOWN HOURS MEAN OPEN, deliberately. If `opening_hours` is empty or
 * malformed we must not silently classify a dead printer as "asleep" — that
 * would hide the exact failure this function exists to surface. Failing towards
 * "the shop is open, so tell me about it" is the safe direction: the worst case
 * is a notification out of hours, not a silent outage during trade.
 */
export function isShopOpen(hours: OpeningHoursEntry[] | null | undefined, now: Date): boolean {
  if (!Array.isArray(hours) || hours.length === 0) return true;

  const { dayKey, minutes } = londonNow(now);
  if (!DAY_KEYS.includes(dayKey as (typeof DAY_KEYS)[number])) return true;

  const today = hours.find(
    (h) => typeof h?.day === 'string' && h.day.slice(0, 3).toLowerCase() === dayKey.toLowerCase(),
  );
  // A day with no entry at all is unknown, not closed — same reasoning.
  if (!today) return true;
  if (today.closed) return false;

  const open = toMinutes(today.open);
  const close = toMinutes(today.close);
  if (open === null || close === null) return true;

  // No overnight trading here (the shop shuts at 19:00 at the latest), so a
  // close time before an open time is a typo rather than a midnight wrap. Treat
  // it as unknown rather than inventing a 23-hour day.
  if (close <= open) return true;

  return minutes >= open && minutes < close;
}

export interface AgentHealthResult {
  health: AgentHealth;
  /** So the screen can say "the shop is shut" rather than implying a fault. */
  shopOpen: boolean;
  /** Null when never seen. Lets the UI say "4 minutes ago" without a second clock. */
  secondsSinceSeen: number | null;
}

export function evaluateAgentHealth(args: {
  lastSeenAt: string | null;
  revokedAt?: string | null;
  openingHours: OpeningHoursEntry[] | null | undefined;
  now?: Date;
}): AgentHealthResult {
  const now = args.now ?? new Date();
  const shopOpen = isShopOpen(args.openingHours, now);

  if (!args.lastSeenAt) {
    // Never checked in. This is not "asleep" even out of hours: an agent that
    // has NEVER been heard from is almost always a token that was issued and
    // never installed, or installed with the wrong one — and that is worth
    // saying plainly whatever the time is.
    return { health: 'never_seen', shopOpen, secondsSinceSeen: null };
  }

  const ageMs = now.getTime() - new Date(args.lastSeenAt).getTime();
  const secondsSinceSeen = Math.max(0, Math.round(ageMs / 1000));

  if (ageMs < STALE_AFTER_MS) return { health: 'ok', shopOpen, secondsSinceSeen };
  // Shut: silence is expected, and the till PC is probably off. Reported before
  // the down/stale thresholds so a closed shop never shows an alarm at all.
  if (!shopOpen) return { health: 'asleep', shopOpen, secondsSinceSeen };
  if (ageMs < DOWN_AFTER_MS) return { health: 'stale', shopOpen, secondsSinceSeen };
  return { health: 'down', shopOpen, secondsSinceSeen };
}
