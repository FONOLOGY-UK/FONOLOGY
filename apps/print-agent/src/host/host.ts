import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { log } from '../logger.js';

/**
 * The Node side of the Windows print host.
 * =========================================================================
 * Owns one long-lived `powershell.exe` running host/print-host.ps1, and turns
 * its line protocol into promises.
 *
 * WHY ONE LONG-LIVED PROCESS (measured, not assumed)
 * On the development machine, spawning powershell.exe cost 428ms and compiling
 * the spooler interop cost a further 843ms. Paying that per sale is the
 * two-second pause that makes staff stop trusting a till. Paying it once at
 * startup makes each print a few milliseconds of interop.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * It does not retry. A retry here would be a SECOND attempt to print, and this
 * layer has no idea whether the first one put ink on paper. Retrying belongs
 * to the queue, which has the marker and the `unconfirmed` state to reason
 * with. See worker.ts.
 *
 * ---------------------------------------------------------------------------
 * ONE HOST PER PRINTER, NOT ONE PER AGENT
 * ---------------------------------------------------------------------------
 * The command loop in print-host.ps1 is strictly serial: read a line, handle it
 * to completion, read the next. With a single shared host, the receipt and
 * label workers queue behind each other in the pipe — and the two-worker design
 * exists specifically so that "a label job that hangs for thirty seconds must
 * not put a customer waiting at the till behind it".
 *
 * A label printer that is out of paper holds its queue-wait for the full 20
 * seconds. Shared, that is 20 seconds of a receipt not printing while somebody
 * stands at the counter — the exact failure the split was meant to prevent, and
 * it would have been invisible until a real roll ran out mid-Saturday.
 *
 * So each worker gets its own host process. The cost is a second
 * `powershell.exe` (~30MB) and a second ~850ms interop compile, both paid once
 * at startup and in parallel. The benefit is that the two printers genuinely
 * cannot block each other, which is what the design already claimed.
 */

export interface HostResponse {
  id?: string;
  ok: boolean;
  stage?: string;
  error?: string | null;
  [key: string]: unknown;
}

/**
 * Read a field off a host response as text, safely.
 *
 * Every field but `ok` arrives through an `unknown` index signature, because
 * the host is a separate process speaking JSON and can in principle send
 * anything. `String(x)` on an object silently produces "[object Object]" — and
 * these values only ever appear in a log line or an error message, i.e. exactly
 * when a printer has failed and the text is all anyone has to go on.
 */
export function hostText(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.stringify(value) ?? fallback;
  } catch {
    // Circular. The shape is already wrong; say so rather than guessing.
    return fallback;
  }
}

/** Same, for a field that should be a number. */
export function hostNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Thrown when we cannot know how far a request got — the host died, or stopped
 * answering. ALWAYS treated by callers as "bytes may have been written".
 */
export class HostUnknownOutcomeError extends Error {}

/** The host is not usable at all (not Windows, or PowerShell is missing). */
export class HostUnavailableError extends Error {}

/**
 * Where print-host.ps1 lives, which depends on how the agent was built.
 *
 *   src/host/host.ts  (pnpm dev, tsx)     -> ./print-host.ps1
 *   dist/index.js     (bundled, shipped)  -> ./print-host.ps1
 *   dist/host/host.js (plain tsc build)   -> ./print-host.ps1
 *
 * The first and third are the same relative path; the bundle collapses the
 * directory, so `./host/print-host.ps1` is checked too. Probing beats picking
 * one and being wrong in a mode nobody tests — and being wrong here fails at
 * runtime on the till PC, with "the file cannot be found" as the only clue.
 */
function resolveScriptPath(): string {
  const candidates = ['./print-host.ps1', './host/print-host.ps1'];
  for (const candidate of candidates) {
    const resolved = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(resolved)) return resolved;
  }
  // Return the primary candidate anyway: spawn will fail with a path in the
  // message, which is more useful than a thrown error from module load time.
  return fileURLToPath(new URL(candidates[0]!, import.meta.url));
}

const SCRIPT_PATH = resolveScriptPath();

interface Pending {
  resolve: (value: HostResponse) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class PrintHost {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private nextId = 1;
  private starting: Promise<void> | null = null;
  private stopped = false;

  /** Names this host in the log, e.g. "receipt" or "label". */
  constructor(private readonly label: string) {}

  /**
   * `windowsPowerShell` rather than `pwsh`: the till PC has Windows PowerShell
   * 5.1 in the box, and PowerShell 7 is an extra install a shop will not have.
   * 5.1 ships System.Drawing via .NET Framework, which the label renderer
   * needs — PowerShell 7 notably does NOT on all platforms, so preferring
   * "newer" here would be a downgrade.
   */
  private readonly exe = 'powershell.exe';

  isSupported(): boolean {
    return process.platform === 'win32';
  }

  private async ensureStarted(): Promise<void> {
    if (this.stopped) throw new HostUnavailableError('The print host has been shut down.');
    if (this.child && !this.child.killed) return;
    if (!this.isSupported()) {
      throw new HostUnavailableError(
        `The Windows print host needs Windows; this process is running on ${process.platform}. ` +
          `Use the "fake" transport to exercise the pipeline here.`,
      );
    }
    if (this.starting) return this.starting;

    this.starting = new Promise<void>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(
          this.exe,
          [
            '-NoProfile',
            '-NonInteractive',
            // Without this the script is refused outright on a machine whose
            // execution policy is Restricted, which is the Windows default on
            // some editions. It weakens nothing: we are launching a specific
            // file we shipped, not enabling scripts machine-wide.
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            SCRIPT_PATH,
          ],
          { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
        );
      } catch (err) {
        reject(new HostUnavailableError(`Could not start ${this.exe}: ${String(err)}`));
        return;
      }

      this.child = child;

      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        this.onLine(line);
      });

      // The host writes diagnostics to stderr specifically so they can be
      // folded into the agent's own log rather than disappearing.
      readline.createInterface({ input: child.stderr }).on('line', (line) => {
        if (line.trim().length > 0) log.debug(`[${this.label}] print-host: ${line.trim()}`);
      });

      child.once('error', (err) => {
        reject(new HostUnavailableError(`Could not start ${this.exe}: ${err.message}`));
      });

      child.once('exit', (code, signal) => {
        this.child = null;
        // Anything still waiting can never be answered, and — critically — we
        // cannot say whether it printed. Rejecting with the "unknown" type is
        // what makes the caller fail safe rather than optimistically.
        const reason = `The ${this.label} print host exited (code ${code}, signal ${signal ?? 'none'}) while ${this.pending.size} request(s) were in flight.`;
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new HostUnknownOutcomeError(reason));
        }
        this.pending.clear();
        if (!this.stopped) log.warn(reason);
      });

      // The script prints "ready" to stderr once the interop has compiled, but
      // waiting for a stderr line to resolve startup would couple this to a log
      // string. A ping is the honest readiness check: it round-trips the actual
      // protocol.
      resolve();
    }).finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let parsed: HostResponse;
    try {
      parsed = JSON.parse(trimmed) as HostResponse;
    } catch {
      log.warn('Discarding an unparseable line from the print host.', trimmed.slice(0, 200));
      return;
    }

    const id = String(parsed.id ?? '');
    const waiting = this.pending.get(id);
    if (!waiting) {
      // A response to a request we already timed out on. Logged, not acted on:
      // the caller has moved on and the job's outcome is already decided.
      log.debug('Late response from the print host, ignored.', { id, ok: parsed.ok });
      return;
    }
    clearTimeout(waiting.timer);
    this.pending.delete(id);
    waiting.resolve(parsed);
  }

  /**
   * Send one command and wait for its answer.
   *
   * A timeout rejects with HostUnknownOutcomeError, NOT with a plain error,
   * because a host that has stopped answering may still have written bytes to
   * the spooler. That distinction is the difference between a silent double
   * print and a question for staff.
   */
  async send(op: string, args: Record<string, unknown>, timeoutMs: number): Promise<HostResponse> {
    await this.ensureStarted();
    const child = this.child;
    if (!child || !child.stdin.writable) {
      throw new HostUnknownOutcomeError('The Windows print host is not accepting commands.');
    }

    const id = String(this.nextId++);
    const payload = JSON.stringify({ id, op, ...args });

    return new Promise<HostResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new HostUnknownOutcomeError(
            `The Windows print host did not answer "${op}" within ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      // A newline terminates the request: the host reads one line at a time.
      child.stdin.write(payload + '\n', (err) => {
        if (!err) return;
        clearTimeout(timer);
        this.pending.delete(id);
        // Failing to WRITE the request is the one case where we know nothing
        // was printed — the host never saw it. Still reported as unknown
        // because a partial write may have been parsed.
        reject(
          new HostUnknownOutcomeError(`Could not send "${op}" to the print host: ${err.message}`),
        );
      });
    });
  }

  /**
   * Round-trip the protocol.
   *
   * Called once at startup, to pay the spawn and the ~850ms interop compile
   * while the shop is opening rather than while a customer waits. Device health
   * uses the `printerStatus` op instead, which answers a more useful question.
   */
  async ping(timeoutMs = 20_000): Promise<boolean> {
    try {
      const res = await this.send('ping', {}, timeoutMs);
      return res.ok === true;
    } catch (err) {
      log.warn(`[${this.label}] print host ping failed.`, err);
      return false;
    }
  }

  /**
   * Stop the host.
   *
   * stdin.end() rather than kill(): closing stdin is what the script's read
   * loop treats as "time to go", so it unwinds its own handles. A kill would
   * leave the spooler handles to the OS, which is survivable but messier.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    const child = this.child;
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      /* already gone */
    }
    // Give it a moment to exit on its own, then insist.
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}
