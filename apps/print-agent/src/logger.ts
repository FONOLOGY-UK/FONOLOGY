import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR } from './paths.js';

/**
 * Local logging for the agent.
 * =========================================================================
 * There is no console to read. The agent runs hidden, started by a Scheduled
 * Task, on a PC behind a counter in Glasgow, maintained by people in Pakistan.
 * The log file is the only forensic record of what happened last Saturday.
 *
 * Three properties, all of them requirements rather than niceties:
 *
 *   1. SIZE CAPPED. A disk full of print-agent logs takes the till down with
 *      it. Rotation is by size, not by date: a quiet week must not be able to
 *      leave a stale unrotated file, and a mad loop must not be able to fill
 *      the disk before midnight.
 *
 *   2. REDACTED. The agent handles a bearer token and customer PII (a name and
 *      phone number sit on every bench-ticket label). Neither may ever land in
 *      a file that gets emailed to support. See `redact()`.
 *
 *   3. NEVER THROWS. A logger that can throw turns a cosmetic problem into a
 *      lost sale. Every failure here is swallowed after one attempt to warn on
 *      stderr — which nobody will see, and that is fine, because the
 *      alternative is worse.
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB per file
const MAX_FILES = 5; // ~10 MB total, hard ceiling

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let minLevel: LogLevel = 'info';
export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

const LOG_FILE = path.join(LOG_DIR, 'agent.log');

/**
 * Values that must never reach disk, registered at startup.
 *
 * Registration rather than pattern-matching for the token: we know exactly
 * what the secret is, so exact-match redaction is both cheaper and more
 * reliable than trying to recognise "something that looks like a token".
 */
const secrets = new Set<string>();
export function registerSecret(value: string | undefined | null): void {
  // Short values would redact half the log — a 1-character "secret" is a
  // configuration mistake, not something to honour.
  if (value && value.length >= 8) secrets.add(value);
}

/**
 * Strip anything that must not be logged.
 *
 * Belt and braces, in this order:
 *   - registered secrets, replaced wherever they appear;
 *   - `Bearer <something>` headers, in case a secret was never registered
 *     (an error object from the HTTP layer can carry request headers);
 *   - UK-shaped phone numbers, because a bench-ticket payload carries one and
 *     an error message can quote the payload it failed on.
 *
 * Deliberately NOT trying to redact names: names are unbounded and any regex
 * would be theatre. The real defence is that payload contents are never
 * logged in the first place — see the call sites, which log job ids and kinds
 * only. This is the second line.
 */
export function redact(input: string): string {
  let out = input;
  for (const secret of secrets) {
    out = out.split(secret).join('[redacted]');
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]');
  out = out.replace(/(?:\+44|0)\s?\d[\d\s-]{7,13}\d/g, '[phone redacted]');
  return out;
}

function rotateIfNeeded(): void {
  try {
    const stat = fs.statSync(LOG_FILE, { throwIfNoEntry: false });
    if (!stat || stat.size < MAX_BYTES) return;

    // Drop the oldest, shuffle the rest up. Sync on purpose: rotation happens
    // rarely, and doing it inline means two concurrent writes can never
    // interleave a rotation with an append.
    const oldest = `${LOG_FILE}.${MAX_FILES}`;
    if (fs.existsSync(oldest)) fs.rmSync(oldest, { force: true });
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const from = `${LOG_FILE}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${LOG_FILE}.${i + 1}`);
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    // A failed rotation must not stop the agent printing. Worst case the
    // current file grows past the cap until the next successful rotation.
  }
}

function write(level: LogLevel, message: string, detail?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

  let line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  if (detail !== undefined) {
    let rendered: string;
    if (detail instanceof Error) {
      rendered = `${detail.name}: ${detail.message}`;
    } else if (typeof detail === 'string') {
      rendered = detail;
    } else {
      try {
        rendered = JSON.stringify(detail);
      } catch {
        // Circular, or a toJSON that threw. String(detail) here would print
        // "[object Object]", which tells whoever is reading the log nothing at
        // all. The constructor name at least names what could not be rendered.
        const name =
          typeof detail === 'object' && detail !== null
            ? (detail.constructor?.name ?? 'object')
            : typeof detail;
        rendered = `<unserialisable ${name}>`;
      }
    }
    line += ` | ${rendered}`;
  }
  line = redact(line) + '\n';

  try {
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (err) {
    // One shout into the void, then carry on. If the Scheduled Task was set up
    // with output redirection this is visible; otherwise nothing is lost that
    // was not already lost.
    try {
      process.stderr.write(`[logger] could not write log: ${String(err)}\n`);
    } catch {
      /* stderr is gone too — nothing left to try. */
    }
  }

  // Also to stdout when a human is watching (`pnpm dev`). Never in the
  // installed configuration, where stdout goes nowhere.
  if (process.env.FONOLOGY_AGENT_CONSOLE === '1') {
    process.stdout.write(line);
  }
}

export const log = {
  debug: (message: string, detail?: unknown) => write('debug', message, detail),
  info: (message: string, detail?: unknown) => write('info', message, detail),
  warn: (message: string, detail?: unknown) => write('warn', message, detail),
  error: (message: string, detail?: unknown) => write('error', message, detail),
};
