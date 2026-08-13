import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import { INSTANCE_FILE } from './paths.js';
import { log } from './logger.js';

/**
 * Making "two agents are running" safe.
 * =========================================================================
 * Two agents both leasing jobs is the failure that produces a double-printed
 * receipt without anything looking broken. There are two distinct ways it
 * happens and they need different answers:
 *
 *   A. TWO COPIES ON ONE PC. Somebody runs the installer twice, or launches it
 *      by hand while the Scheduled Task already has it running. Handled here,
 *      locally, by `claimSingleInstance()`.
 *
 *   B. TWO PCs SHARING ONE TOKEN. Somebody copies the install folder to a
 *      second machine. No amount of local locking can see that. Handled by the
 *      server: only the primary agent may lease (enforced inside
 *      `claim_print_job`, in the database), and the heartbeat's `instanceId`
 *      makes the second install VISIBLE rather than silent.
 *
 * The agent's job is to be safe under both and loud under either.
 */

/* ==========================================================================
 * The installation id — case B
 * ======================================================================== */

/**
 * A random id generated once per INSTALLATION and kept on disk forever.
 *
 * Not the hostname: two shops could have a PC called TILL, and a machine
 * rename would silently look like a new install. Not a per-process id either —
 * that would make every restart look like a conflict and train staff to ignore
 * the warning.
 *
 * Copying the install folder to a second PC copies this id too, so two copies
 * report the SAME id and no conflict is raised. That is the honest limit of
 * this mechanism, and it is why the server-side primary check (which does not
 * care how many installs exist) is the actual safety net rather than this.
 * What this catches is the more common case: a genuine second install, issued
 * its own token or given a copied one, generating its own id.
 */
export function loadInstanceId(): string {
  try {
    const existing = fs.readFileSync(INSTANCE_FILE, 'utf8').trim();
    if (existing.length > 0) return existing;
  } catch {
    /* first run */
  }
  const fresh = crypto.randomUUID();
  try {
    fs.writeFileSync(INSTANCE_FILE, fresh, 'utf8');
  } catch (err) {
    // Not fatal: a per-process id still authenticates and still prints. It
    // just makes conflict detection noisy. Worth a loud log.
    log.warn('Could not persist the installation id; conflict detection will be unreliable.', err);
  }
  return fresh;
}

/* ==========================================================================
 * The single-instance lock — case A
 * ======================================================================== */

/**
 * Refuse to start if another agent is already running on this machine.
 *
 * WHY A LOCALHOST PORT AND NOT A LOCK FILE
 * A lock file has a stale-lock problem: the agent is killed by a power cut,
 * the file survives, and the agent then refuses to start forever — turning a
 * reboot into a dead till that nobody can fix. Every workaround (PID checks,
 * timestamps, heartbeats into the lock) reintroduces a race.
 *
 * A bound TCP socket has no such problem. The OS releases the port when the
 * process dies, however it dies, including a hard power cut. There is nothing
 * to clean up and nothing to go stale. The check is also genuinely atomic —
 * two processes racing to bind cannot both win.
 *
 * Bound to 127.0.0.1 explicitly, never 0.0.0.0: this must not be reachable
 * from the shop LAN, let alone anywhere else. It accepts no connections and
 * speaks no protocol; the bind IS the lock.
 */
export interface InstanceLock {
  release(): void;
}

export class AlreadyRunningError extends Error {}

export function claimSingleInstance(port: number): Promise<InstanceLock> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    // Left deliberately unset: SO_REUSEADDR would let a second instance bind
    // the same port in some states, which is the exact opposite of what this
    // is for.
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        reject(
          new AlreadyRunningError(
            `Another Fonology print agent is already running on this PC (lock port ${port} is held). ` +
              `Refusing to start a second one — two agents can double-print a receipt.`,
          ),
        );
        return;
      }
      reject(err);
    });

    server.once('listening', () => {
      // Do not let an idle lock socket hold the event loop open on its own;
      // the agent's real work is what keeps the process alive.
      server.unref();
      resolve({
        release() {
          try {
            server.close();
          } catch {
            /* shutting down anyway */
          }
        },
      });
    });

    // Connections are never expected. Anything that does arrive is closed
    // immediately rather than left to accumulate.
    server.on('connection', (socket) => socket.destroy());

    server.listen({ port, host: '127.0.0.1', exclusive: true });
  });
}
