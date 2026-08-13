import net from 'node:net';
import type { DeviceReport, PrintContext, ReceiptTransport, TransportResult } from './types.js';

/**
 * The receipt printer as a network device — port 9100, raw ESC/POS.
 * =========================================================================
 * Built NOW, before anyone knows whether it is needed, because that is what
 * makes assumption 1 cheap to be wrong about. If the POS80GXa turns out to be
 * on the shop LAN rather than USB, the fix is:
 *
 *     printer_config.receipt.transport = "tcp"
 *     printer_config.receipt.host      = "192.168.1.x"
 *
 * and nothing is rebuilt, redeployed, or reinstalled. Writing this file cost
 * an hour; discovering on install day that it did not exist would cost a trip.
 *
 * Port 9100 is the JetDirect/RAW convention that essentially every networked
 * receipt printer implements: open a socket, write bytes, close. There is no
 * handshake and no acknowledgement, which is precisely why the marker exists —
 * a successful write tells you the TCP stack accepted the bytes, never that
 * paper came out.
 *
 * ---------------------------------------------------------------------------
 * WHERE reachedPrinter FLIPS, AND WHY EXACTLY THERE
 * ---------------------------------------------------------------------------
 * Before the connection is established, nothing can have printed: a refused or
 * timed-out connect is safely retryable. From the first `write()` onwards we
 * cannot know — TCP will happily report a write as flushed to a socket whose
 * far end has already been unplugged. So the flip happens on connect, not on
 * write completion, and everything after it fails safe.
 */
export class TcpTransport implements ReceiptTransport {
  readonly name: string;

  constructor(
    private readonly host: string | null,
    private readonly port: number,
    private readonly connectTimeoutMs = 5_000,
    private readonly writeTimeoutMs = 15_000,
  ) {
    this.name = `tcp (${host ?? 'NOT CONFIGURED'}:${port})`;
  }

  async send(bytes: Uint8Array, _ctx: PrintContext): Promise<TransportResult> {
    if (!this.host) {
      return {
        ok: false,
        reachedPrinter: false,
        error:
          'Receipt transport is set to "tcp" but printer_config.receipt.host is empty. Set the printer\'s IP address in shop settings.',
      };
    }

    // Narrowed once, here. TypeScript cannot carry the null check above into
    // the callbacks below, and re-checking inside each one would be noise.
    const host = this.host;

    return new Promise<TransportResult>((resolve) => {
      const socket = new net.Socket();
      let connected = false;
      let settled = false;

      const finish = (result: TransportResult) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(this.connectTimeoutMs);

      socket.once('timeout', () => {
        finish({
          ok: false,
          // If we never connected, nothing was sent. If we did, the bytes may
          // be sitting in the printer's buffer already.
          reachedPrinter: connected,
          error: connected
            ? `The printer stopped responding mid-job (${host}:${this.port}).`
            : `Timed out connecting to ${host}:${this.port}.`,
        });
      });

      socket.once('error', (err) => {
        finish({
          ok: false,
          reachedPrinter: connected,
          error: `${connected ? 'Write to' : 'Connect to'} ${host}:${this.port} failed: ${err.message}`,
        });
      });

      socket.connect(this.port, host, () => {
        connected = true;
        socket.setTimeout(this.writeTimeoutMs);

        socket.write(Buffer.from(bytes), (err) => {
          if (err) {
            finish({ ok: false, reachedPrinter: true, error: `Write failed: ${err.message}` });
            return;
          }
          // `end()` flushes and half-closes. Resolving on its callback means we
          // waited for the kernel to hand everything off rather than resolving
          // the moment write() returned.
          socket.end(() => {
            finish({ ok: true, detail: `${bytes.length} bytes to ${host}:${this.port}` });
          });
        });
      });
    });
  }

  async check(): Promise<DeviceReport> {
    if (!this.host) {
      return { status: 'error', detail: 'Receipt transport is "tcp" but no host is configured.' };
    }
    const host = this.host;

    // A bare connect-and-close. Deliberately does not send anything: a health
    // check that emits bytes is a health check that can print.
    return new Promise<DeviceReport>((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      const done = (report: DeviceReport) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(report);
      };
      socket.setTimeout(this.connectTimeoutMs);
      socket.once('timeout', () =>
        done({ status: 'error', detail: `No answer from ${host}:${this.port}.` }),
      );
      socket.once('error', (err) =>
        done({ status: 'error', detail: `${host}:${this.port} — ${err.message}` }),
      );
      socket.connect(this.port, host, () =>
        done({ status: 'ok', detail: `Reachable at ${host}:${this.port}.` }),
      );
    });
  }
}
