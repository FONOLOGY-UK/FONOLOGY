import { z } from 'zod';
import { printerConfigSchema, type PrinterConfig } from './printerConfig.js';
import { shopDetailsSchema, type ShopDetails } from './shopDetails.js';
import { AGENT_VERSION } from './version.js';
import type { AgentConfig } from './config.js';
import type { DeviceReport } from './transports/types.js';

/**
 * The API client.
 * =========================================================================
 * Every schema in this file was written against apps/api/src/routes/print.routes.ts
 * — the code that actually builds the responses — and not against the table
 * columns or the enqueue body. That distinction is the standing rule here: the
 * REAL response is the contract, and it is camelCase and reshaped, while the
 * database is snake_case.
 *
 * Nothing in this file retries. Retry policy belongs to the worker, which is
 * the only place that knows whether a failure happened before or after bytes
 * went to a printer — and that difference is the safety property.
 */

/* ==========================================================================
 * Typed failures — the worker branches on these, so they are types, not strings
 * ======================================================================== */

/** 401. The token was revoked or is wrong. Retrying cannot fix it. */
export class AgentUnauthorizedError extends Error {}

/** 409 on claim. Another agent is primary; this one must not lease anything. */
export class NotPrimaryError extends Error {}

/** The lease is gone — expired and swept, or taken. Our outcome no longer applies. */
export class LeaseLostError extends Error {}

/** Anything transport-level: no route to host, DNS, TLS, timeout, 5xx. */
export class ApiUnreachableError extends Error {}

/* ==========================================================================
 * Response schemas — matching print.routes.ts exactly
 * ======================================================================== */

/**
 * The two physical printers. Declared once, here, and derived from the zod
 * enum so the runtime check and the compile-time type cannot drift apart.
 * The literal union was previously spelled out in six places.
 */
export const targetSchema = z.enum(['receipt', 'label']);
export type Target = z.infer<typeof targetSchema>;

/**
 * The payload shapes built by apps/api/src/lib/printPayloads.ts.
 *
 * All six kinds are now built server-side and validated here. Each schema was
 * written against the BUILDER in printPayloads.ts — the code that actually
 * produces the object — and checked against real payloads generated from the
 * dev project, not against the table columns.
 *
 * A kind with no schema still cannot crash the agent: the renderers switch on
 * `kind` and fall through to renderUnknownReceipt / renderUnknownLabel, which
 * print an inspectable diagnostic rather than throwing.
 */
export const saleReceiptPayloadSchema = z.object({
  version: z.literal(1),
  kind: z.literal('sale_receipt'),
  reference: z.string(),
  soldAt: z.string(),
  staffName: z.string().nullable(),
  lines: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      /** Integer pence. Pounds exist only at the moment of rendering. */
      unitPrice: z.number().int(),
      lineTotal: z.number().int(),
      tierApplied: z.boolean(),
    }),
  ),
  subtotal: z.number().int(),
  discount: z.number().int(),
  total: z.number().int(),
  payments: z.array(
    z.object({
      tender: z.string(),
      amount: z.number().int(),
      machineLabel: z.string().nullable(),
      reference: z.string().nullable(),
    }),
  ),
});

export const jobLabelPayloadSchema = z.object({
  version: z.literal(1),
  kind: z.literal('job_label'),
  reference: z.string(),
  createdAt: z.string(),
  customerName: z.string(),
  phone: z.string(),
  deviceDescription: z.string(),
  problemDescription: z.string(),
  quotedPrice: z.number().int().nullable(),
  paymentStatus: z.string(),
});

/**
 * A refund. Two references and two tenders — see the builder for why each pair
 * exists rather than one of each.
 */
export const refundReceiptPayloadSchema = z.object({
  version: z.literal(1),
  kind: z.literal('refund_receipt'),
  /** This refund's own REF- number (migration 0035). */
  reference: z.string(),
  /** The sale or order it was taken against. Null for neither. */
  originalReference: z.string().nullable(),
  originalKind: z.enum(['sale', 'order']).nullable(),
  refundedAt: z.string(),
  staffName: z.string().nullable(),
  lines: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      unitPrice: z.number().int(),
      lineTotal: z.number().int(),
    }),
  ),
  /** POSITIVE pence — refunds.amount carries a `> 0` check. */
  amount: z.number().int(),
  refundTender: z.string(),
  originalTender: z.string().nullable(),
});

export const payoutReceiptPayloadSchema = z.object({
  version: z.literal(1),
  kind: z.literal('payout_receipt'),
  /** BUY- series. */
  reference: z.string(),
  paidAt: z.string(),
  staffName: z.string().nullable(),
  customerName: z.string(),
  deviceLabel: z.string(),
  /**
   * NEGATIVE, exactly as the ledger stores it. The renderer takes the absolute
   * value and states the direction in words; the sign convention is not
   * silently unwound anywhere between here and the paper.
   */
  amount: z.number().int(),
  method: z.string(),
  sellRequestReference: z.string().nullable(),
});

export const shelfLabelPayloadSchema = z.object({
  version: z.literal(1),
  kind: z.literal('shelf_label'),
  name: z.string(),
  sub: z.string().nullable(),
  /** Effective single-unit price from resolve_sale_unit_price. */
  price: z.number().int(),
  barcode: z.string().nullable(),
  bulkTiers: z.array(z.object({ minQty: z.number().int(), unitPrice: z.number().int() })),
  issuedAt: z.string(),
  // NOTE what is absent: stock, cost, margin. The server never sends them
  // (buildShelfLabel does not select those columns) and this schema would
  // strip them if it somehow did.
});

/** Kept in step with printTestVariantSchema in apps/api/src/schemas.ts. */
export const testVariantSchema = z.enum(['width', 'cut', 'encoding', 'barcode', 'label']);
export type TestVariant = z.infer<typeof testVariantSchema>;

export const testPrintPayloadSchema = z.object({
  version: z.literal(1),
  kind: z.literal('test_print'),
  target: targetSchema,
  /**
   * Defaulted rather than required, so a job enqueued before this field
   * existed still prints something sensible instead of failing to parse three
   * times and landing in the failed queue.
   */
  variant: testVariantSchema.default('width'),
  issuedAt: z.string(),
  /** Set for the `barcode` and `label` variants; null otherwise. */
  product: z.object({ name: z.string(), barcode: z.string() }).nullable().default(null),
});

export const printJobSchema = z.object({
  id: z.string(),
  kind: z.string(),
  target: targetSchema,
  payload: z.unknown(),
  attempts: z.number().int(),
  /** Sent as `leaseExpiresAt`, from the row's `lease_expires_at`. */
  leaseExpiresAt: z.string().nullable(),
});
export type PrintJob = z.infer<typeof printJobSchema>;

export const heartbeatResponseSchema = z.object({
  ok: z.boolean(),
  isPrimary: z.boolean(),
  instanceConflict: z.boolean(),
});
export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;

/**
 * A device report plus which printer it is about.
 *
 * Extends `DeviceReport` rather than restating it — the hand-written copy had
 * already drifted (`detail` gained an `undefined` the transport side never
 * produces), which is exactly what a near-duplicate type does over time.
 */
export interface DeviceHealth extends DeviceReport {
  target: Target;
}

/* ==========================================================================
 * The client
 * ======================================================================== */

export class PrintApiClient {
  constructor(
    private readonly cfg: AgentConfig,
    private readonly instanceId: string,
  ) {}

  /**
   * One request, with the timeout covering the BODY as well as the headers.
   *
   * That distinction is not pedantry. `fetch` resolves as soon as the response
   * HEADERS arrive, so clearing the timer at that point leaves `res.json()`
   * unprotected and falling back on undici's 300-second body timeout. A server
   * that sends headers and then stalls would park a worker for five minutes
   * with nothing in the log — the exact "looks alive, prints nothing" failure
   * the timeout exists to prevent.
   *
   * So the body is read HERE, inside the same abort scope, and the timer is
   * only cleared once there is nothing left to wait for.
   */
  private async request(
    pathAndQuery: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<{ status: number; ok: boolean; json: unknown }> {
    // Node's fetch has no useful default timeout, so a half-open socket — the
    // classic consumer-router-reboot symptom — would park a poll forever and
    // the agent would look alive while printing nothing.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.cfg.apiBaseUrl}${pathAndQuery}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.headers ?? {}),
          authorization: `Bearer ${this.cfg.token}`,
        },
      });

      // 204 has no body by definition, and an error response's body is never
      // read — the status is the whole message.
      let json: unknown = undefined;
      if (res.ok && res.status !== 204) {
        json = await res.json().catch(() => undefined);
      }

      if (res.status === 401) {
        throw new AgentUnauthorizedError(
          'The print agent token was rejected. It has been revoked, or the config file holds the wrong one.',
        );
      }
      return { status: res.status, ok: res.ok, json };
    } catch (err) {
      // Rethrown as-is: it is a decision the caller must not confuse with a
      // network problem, because retrying cannot fix it.
      if (err instanceof AgentUnauthorizedError) throw err;
      // Every network-shaped failure becomes one type. The worker treats them
      // all identically — back off and try again — so distinguishing DNS from
      // TLS here would be detail without a decision attached.
      throw new ApiUnreachableError(
        err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Long-poll for the next job on one target.
   *
   * Returns null when there is nothing to do — the server answers 204 for
   * that, deliberately, so "no work" is never mistaken for "a job with no
   * fields".
   *
   * The HTTP timeout is the long-poll budget plus a margin. The margin has to
   * be generous: it covers the server's own claim round trip AFTER the wait
   * expires, and cutting a poll off early is indistinguishable here from a
   * dead line.
   */
  async claimNext(opts: {
    target: Target;
    leaseSeconds: number;
    waitSeconds: number;
  }): Promise<PrintJob | null> {
    const query = new URLSearchParams({
      target: opts.target,
      leaseSeconds: String(opts.leaseSeconds),
      waitSeconds: String(opts.waitSeconds),
    });
    const res = await this.request(
      `/print/jobs/next?${query.toString()}`,
      { method: 'GET' },
      opts.waitSeconds * 1000 + 15_000,
    );

    if (res.status === 409) {
      throw new NotPrimaryError(
        'This agent is not the primary print agent — another install is handling the queue.',
      );
    }
    if (res.status === 204) return null;
    if (!res.ok) {
      throw new ApiUnreachableError(`Claim failed with HTTP ${res.status}.`);
    }

    const parsed = printJobSchema.safeParse(res.json);
    if (!parsed.success) {
      // A job we cannot even parse must not be silently dropped — but neither
      // can we act on it. Treated as unreachable so the worker backs off
      // rather than hot-looping on a malformed response.
      throw new ApiUnreachableError(`Claim response did not match the expected shape.`);
    }
    return parsed.data;
  }

  /**
   * We got paper out.
   *
   * A 409 here is NOT an error worth shouting about: it means our lease
   * expired and the sweep already moved the job on. The bytes still printed;
   * the queue simply stopped waiting for us. The caller must still clear its
   * marker, which is why this resolves rather than throws for that case.
   */
  async ack(jobId: string): Promise<{ accepted: boolean }> {
    const res = await this.request(
      `/print/jobs/${encodeURIComponent(jobId)}/ack`,
      { method: 'POST' },
      15_000,
    );
    if (res.status === 409) return { accepted: false };
    if (!res.ok) throw new ApiUnreachableError(`Ack failed with HTTP ${res.status}.`);
    return { accepted: true };
  }

  /**
   * We could not print it.
   *
   * `reachedPrinter` is the single most important value this agent ever sends.
   * It is derived from the on-disk marker and from how far the transport got —
   * never from optimism. See worker.ts.
   */
  async fail(jobId: string, reachedPrinter: boolean, error: string): Promise<void> {
    const res = await this.request(
      `/print/jobs/${encodeURIComponent(jobId)}/fail`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The server caps this at 2000 characters; truncating here means a
        // long stack trace is a shorter message rather than a 400 that loses
        // the report entirely.
        body: JSON.stringify({ reachedPrinter, error: error.slice(0, 1900) }),
      },
      15_000,
    );
    if (res.status === 409) throw new LeaseLostError('That lease is no longer held by this agent.');
    if (!res.ok) throw new ApiUnreachableError(`Fail report rejected with HTTP ${res.status}.`);
  }

  async heartbeat(devices: DeviceHealth[]): Promise<HeartbeatResponse> {
    const res = await this.request(
      '/print/heartbeat',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentVersion: AGENT_VERSION,
          instanceId: this.instanceId,
          // The server's schema caps this at 2 entries — one per physical
          // printer. Sending more is a 400, so the cap is honoured here.
          devices: devices.slice(0, 2),
        }),
      },
      15_000,
    );
    if (!res.ok) throw new ApiUnreachableError(`Heartbeat failed with HTTP ${res.status}.`);

    const parsed = heartbeatResponseSchema.safeParse(res.json);
    if (!parsed.success)
      throw new ApiUnreachableError('Heartbeat response had an unexpected shape.');
    return parsed.data;
  }

  /**
   * Printer configuration. Note the endpoint returns `{}` when the settings
   * row is missing, which is why every field in printerConfigSchema has a
   * default.
   */
  async fetchPrinterConfig(): Promise<PrinterConfig> {
    const res = await this.request('/print/config', { method: 'GET' }, 15_000);
    if (!res.ok) throw new ApiUnreachableError(`Config fetch failed with HTTP ${res.status}.`);

    const parsed = printerConfigSchema.safeParse(res.json);
    if (!parsed.success) {
      throw new ApiUnreachableError(
        `printer_config in shop_settings is not valid: ${parsed.error.issues
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data;
  }

  /**
   * The shop's own name, address and phone, for the head of a receipt.
   *
   * `GET /shop` is the one endpoint on this API with NO auth at all, so this
   * works with the agent's deliberately feeble token — and it is the endpoint
   * whose own header calls out the till as a reason it exists. See
   * shopDetails.ts for why these are fetched rather than hardcoded.
   */
  async fetchShopDetails(): Promise<ShopDetails> {
    const res = await this.request('/shop', { method: 'GET' }, 15_000);
    if (!res.ok)
      throw new ApiUnreachableError(`Shop details fetch failed with HTTP ${res.status}.`);

    const parsed = shopDetailsSchema.safeParse(res.json);
    if (!parsed.success) {
      throw new ApiUnreachableError('Shop details had an unexpected shape.');
    }
    return parsed.data;
  }
}
