import fs from 'node:fs';
import path from 'node:path';
import { MARKER_DIR } from './paths.js';

/**
 * THE ON-DISK MARKER — the entire safety property of this system.
 * =========================================================================
 * `reachedPrinter` is the one boolean the server uses to decide whether a
 * receipt may be auto-retried or must stop and ask a human. Everything else in
 * the queue is bookkeeping; this is the safety argument.
 *
 * The rule:
 *
 *   marker present  → bytes MAY have reached the printer → the job resolves to
 *                     `unconfirmed`, and a person is asked whether paper came
 *                     out. Never auto-reprinted.
 *   marker absent   → bytes CANNOT have reached the printer → safe to requeue
 *                     and retry automatically.
 *
 * The dangerous direction is exactly one: a marker that should exist but does
 * not. That is a double-printed receipt in a customer's hand, which is what a
 * fraudulent return looks like. A spurious marker only costs a staff member
 * one tap on a question. So every trade-off below is resolved towards
 * "assume it printed".
 *
 * ---------------------------------------------------------------------------
 * HOW THIS SURVIVES THE PLUG BEING PULLED
 * ---------------------------------------------------------------------------
 * The realistic failure is not a clean exit — it is someone switching the PC
 * off at the wall mid-receipt. `fs.writeFileSync` alone is NOT enough for
 * that: it returns once the data is in the OS page cache, and a power cut
 * between that return and the cache being flushed loses the marker while the
 * printer has already had the bytes. That is precisely the double-print case.
 *
 * So `writeMarker()` does four things, in this order, and the order is the
 * whole point:
 *
 *   1. Write the marker body to a temp file in the SAME directory.
 *   2. `fs.fsyncSync(fd)` on that temp file. On Windows this maps to
 *      FlushFileBuffers, which pushes the file's data AND its metadata out of
 *      the OS cache and instructs the drive to commit its own write cache.
 *   3. `fs.renameSync(tmp, final)` — atomic within a directory on NTFS, so a
 *      reader can never observe a half-written marker.
 *   4. Only then does the caller send a single byte to the printer.
 *
 * There is no directory fsync, and that is not an oversight: Windows does not
 * expose one (you cannot open a directory for FlushFileBuffers through Node),
 * and NTFS journals metadata operations, so the rename is recoverable by the
 * filesystem itself. This is the standard durability posture on NTFS and it is
 * the strongest guarantee available to a Node process without native code.
 *
 * The honest residual risk: FlushFileBuffers asks the drive to commit its
 * cache, and a drive with a volatile cache and buggy firmware can lie about
 * having done so. Nothing in userspace can close that gap. It is a
 * property of the hardware, not of this file. See UNVERIFIED notes in
 * README.md.
 *
 * ---------------------------------------------------------------------------
 * WHY A PARSE FAILURE STILL COUNTS AS "PRESENT"
 * ---------------------------------------------------------------------------
 * `readMarker()` returns "present" for any file that exists, including one
 * that is empty, truncated or unparseable. The atomic rename should make that
 * impossible — but the safety argument must not DEPEND on the atomic rename
 * being perfect. A corrupt marker is still evidence that we were mid-print,
 * and the fail-safe reading of the evidence is "it may have printed".
 *
 * That inversion is what makes step 3 above an optimisation rather than a
 * correctness requirement, which is a much stronger place to stand.
 */

export interface MarkerBody {
  jobId: string;
  target: 'receipt' | 'label';
  kind: string;
  /** ISO timestamp of the moment before the first byte was sent. */
  startedAt: string;
  /** Which installation wrote it — see instance.ts. */
  instanceId: string;
}

export interface FoundMarker {
  jobId: string;
  /** Null when the file existed but could not be parsed. Still counts. */
  body: MarkerBody | null;
  file: string;
}

/**
 * One file per job id rather than one shared file.
 *
 * A single "current job" file would have to be rewritten on every print, and a
 * crash during that rewrite is a window where the marker names the WRONG job.
 * Per-job files make every write a create and every clear a delete, with no
 * mutation step to get caught halfway through.
 */
function markerPath(jobId: string): string {
  // Job ids are server-generated uuids. Sanitising anyway: this value becomes
  // a filename, and "the server would never send that" is how directory
  // traversal gets in.
  const safe = jobId.replace(/[^A-Za-z0-9-]/g, '_');
  return path.join(MARKER_DIR, `${safe}.marker`);
}

/**
 * Record that we are about to send bytes. MUST complete before the first byte.
 *
 * Throws on failure, and the caller MUST treat that as "do not print". An
 * unmarked print is the one outcome this system may not have: if we cannot
 * write the marker we cannot promise not to double-print, so we do not print
 * at all. A receipt that did not print is a reprint; a receipt that printed
 * twice is a dispute.
 */
export function writeMarker(body: MarkerBody): void {
  const target = markerPath(body.jobId);
  const tmp = `${target}.tmp`;
  const data = Buffer.from(JSON.stringify(body), 'utf8');

  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data, 0, data.length, 0);
    // The load-bearing line. Without it the rest is decoration.
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
}

/**
 * Clear the marker after a confirmed outcome.
 *
 * Called on two paths only:
 *   - the server has accepted our ack (the job is terminal, server-side), or
 *   - the transport proved it never wrote a byte, so the marker was a lie.
 *
 * Never called merely because printing "seemed to work". The marker is cheap
 * to leave behind for one extra second and expensive to remove early.
 */
export function clearMarker(jobId: string): void {
  try {
    fs.rmSync(markerPath(jobId), { force: true });
  } catch {
    // A marker we failed to delete is re-read on the next start and resolved
    // as unconfirmed — a question for staff, not a wrong print. Safe to
    // swallow.
  }
}

/** Is there a marker for this specific job? */
export function hasMarker(jobId: string): boolean {
  return fs.existsSync(markerPath(jobId));
}

/**
 * Every marker left on disk — i.e. every job we were mid-print on when we
 * stopped. Read once at startup, before any polling begins.
 */
export function readOrphanedMarkers(): FoundMarker[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(MARKER_DIR);
  } catch {
    return [];
  }

  const found: FoundMarker[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.marker')) continue; // skip abandoned .tmp files
    const file = path.join(MARKER_DIR, entry);

    let body: MarkerBody | null = null;
    try {
      body = JSON.parse(fs.readFileSync(file, 'utf8')) as MarkerBody;
    } catch {
      // Deliberately kept. See the header: existence is the signal, content is
      // only ever a convenience for the log line.
      body = null;
    }

    // The filename is the fallback identity precisely so an unreadable body
    // still names a job. Loses nothing but the timestamp.
    found.push({ jobId: body?.jobId ?? entry.replace(/\.marker$/, ''), body, file });
  }
  return found;
}

/**
 * Delete `.tmp` files left by a crash mid-write.
 *
 * Safe by construction: a `.tmp` file has not been renamed, so no byte was
 * ever sent for it — writeMarker() only returns to its caller after the
 * rename. Housekeeping, not safety.
 */
export function sweepTempMarkers(): void {
  try {
    for (const entry of fs.readdirSync(MARKER_DIR)) {
      if (entry.endsWith('.tmp')) {
        fs.rmSync(path.join(MARKER_DIR, entry), { force: true });
      }
    }
  } catch {
    /* nothing here is worth failing a startup over */
  }
}
