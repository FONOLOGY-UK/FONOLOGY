import { z } from 'zod';
import { paginationFields } from './lib/pagination.js';

/**
 * Request-body validation. Mirrors apps/web/src/lib/data/types/auth.ts
 * (signInInputSchema, signUpInputSchema) exactly — same field names, same
 * constraints — so the frontend's http.adapter.ts can send its existing
 * SignInInput/SignUpInput bodies unchanged.
 */

export const signInBodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});

export const signUpBodySchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  password: z.string().min(8),
});

export const emailBodySchema = z.object({
  email: z.string().trim().email(),
});

export const pinBodySchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
});

export const unlockBodySchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
});

export const guestResolveQuerySchema = z.object({
  reference: z.string().trim().min(1),
  email: z.string().trim().email(),
});

/**
 * Mirrors apps/web's orderInputSchema (types/order.ts) exactly in SHAPE, so
 * a real request from http.adapter.ts validates — but every price-bearing
 * field on each line (`unitPrice`, `name`, `sub`, `slug`) is accepted here
 * only to satisfy the shape; none of it is ever read for money. The route
 * handler re-derives price, name and everything else from `productId`
 * against the database. See orders.routes.ts.
 */
export const orderLineBodySchema = z.object({
  productId: z.string().min(1),
  name: z.string().optional(),
  sub: z.string().optional(),
  slug: z.string().optional(),
  kind: z.string().optional(),
  unitPrice: z.number().optional(),
  quantity: z.number().int().positive(),
});

export const orderInputBodySchema = z.object({
  lines: z.array(orderLineBodySchema).min(1),
  email: z.string().trim().email(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  // 'remote' removed (0021/B3 follow-up) — it was never a real choice, it's
  // a fact about the postcode the server derives. The customer picks speed
  // (collect/standard/next-day); the zone comes from delivery_quote().
  delivery: z.enum(['collect', 'standard', 'next-day']),
  address: z.string().optional(),
  postcode: z.string().optional(),
  paymentMethod: z.enum(['stripe', 'clearpay']).optional(),
  // Accepted so a real request validates — deliberately never used to
  // compute a discount. See the B3 report: the schema has no online
  // discount-code redemption path, by design (0005_orders.sql).
  promoCode: z.string().optional(),
  verification: z
    .object({
      registrationDoc: z.string().min(1),
      licence: z.string().min(1),
    })
    .nullable()
    .optional(),
});

/** POST /orders/delivery-quote — what create_order would actually charge. */
export const deliveryQuoteBodySchema = z.object({
  lines: z.array(orderLineBodySchema).min(1),
  delivery: z.enum(['collect', 'standard', 'next-day']),
  postcode: z.string().optional(),
});

export const orderStatusBodySchema = z.object({
  status: z.enum(['pending', 'paid', 'ready', 'collected', 'shipped', 'cancelled']),
});

export const documentRejectBodySchema = z.object({
  reason: z.string().trim().min(1),
});

/**
 * Mirrors apps/web's saleInputSchema (types/pos.ts) in SHAPE. `unitPrice`,
 * `listPrice`, `costPrice`, `tierApplied` on each line are accepted so a
 * real request validates — never read. The route re-derives every one from
 * `products` and `resolve_sale_unit_price()`. `discount` IS a legitimate
 * staff-entered input here (till discounts are a real, till-only feature —
 * unlike checkout's promoCode) and is passed through; the schema's own
 * `sales_discount_not_over_subtotal` CHECK is what actually bounds it.
 */
export const saleLineBodySchema = z.object({
  productId: z.string().min(1),
  name: z.string().optional(),
  sub: z.string().optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().optional(),
  listPrice: z.number().optional(),
  costPrice: z.number().optional(),
  tierApplied: z.boolean().optional(),
});

export const salePaymentBodySchema = z.object({
  tender: z.enum(['cash', 'pos1', 'pos2', 'transfer']),
  amount: z.number().positive(),
});

export const saleInputBodySchema = z.object({
  lines: z.array(saleLineBodySchema).min(1),
  discount: z.number().min(0),
  payments: z.array(salePaymentBodySchema).min(1),
  belowCostReason: z.string().trim().optional(),
});

export const returnLineBodySchema = z.object({
  productId: z.string().nullable(),
  name: z.string().trim().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number(),
});

export const refundInputBodySchema = z.object({
  source: z.enum(['order', 'counter', 'no-receipt']),
  reference: z.string().trim().nullable(),
  lines: z.array(returnLineBodySchema),
  amount: z.number().positive(),
  reason: z.string().trim().min(3),
  tender: z.enum(['cash', 'pos1', 'pos2', 'transfer', 'stripe']),
  restock: z.boolean(),
  override: z.boolean(),
});

export const cashEntryInputBodySchema = z.object({
  kind: z.enum(['float-open', 'petty-in', 'petty-out']),
  amount: z.number().positive(),
  note: z.string().trim().min(2),
});

export const dayCloseBodySchema = z.object({
  // You cannot count negative physical money. `day_close.counted_amount >= 0`
  // enforces this in the database too, but reaching it means a 500 rather
  // than something the till operator can act on.
  countedAmount: z.number().int().nonnegative('Counted cash cannot be negative.'),
  note: z.string().trim().optional(),
});

/* ---- B5: repairs & trade-ins ------------------------------------------- */

/**
 * Mirrors apps/web's bookingInputSchema (types/repair.ts) in field names.
 * `address` is one free-text line, same pattern as B3's orders — stored
 * whole in address_line1, no city required (bookings.city was already
 * nullable, unlike orders' original city column — no migration needed here).
 */
export const bookingInputBodySchema = z.object({
  deviceId: z.string().min(1),
  repairId: z.string().min(1),
  tierId: z.enum(['original', 'oem', 'copy']).nullable(),
  name: z.string().trim().min(2),
  phone: z.string().trim().min(1),
  email: z.string().trim().email(),
  address: z.string().trim().min(4),
  postcode: z.string().trim().min(1),
  preferredContact: z.enum(['phone', 'email']),
  notes: z.string().max(1000).optional(),
});

/** The "Other" path — no device reference at all, a human follows up. */
export const repairEnquiryBodySchema = z.object({
  customerName: z.string().trim().min(2),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  deviceDescription: z.string().trim().min(2),
  faultDescription: z.string().trim().min(3),
});

/**
 * Job creation. No adapter/mock wiring — see the B5 report: the mock's Job
 * model (4 linear statuses, hyphenated) cannot represent the real,
 * client-confirmed lifecycle (waiting_approval, cancellation with
 * device-held tracking, mail-in-vs-walk-in terminal states) at all. This
 * mirrors the schema's own shape directly.
 */
export const jobCreateBodySchema = z.object({
  source: z.enum(['walk_in', 'mail_in', 'online']),
  bookingId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  customerName: z.string().trim().min(2),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  deviceDescription: z.string().trim().min(2),
  problemDescription: z.string().trim().min(3),
  notes: z.string().max(1000).optional(),
  quotedPrice: z.number().int().nonnegative().nullable().optional(),
});

export const jobStatusBodySchema = z.object({
  status: z.enum([
    'new',
    'in_progress',
    'waiting_approval',
    'done',
    'sent_back',
    'collected',
    'cancelled',
  ]),
  // waiting_approval
  revisedQuote: z.number().int().nonnegative().optional(),
  // leaving waiting_approval back to in_progress (approving the revised quote)
  approved: z.boolean().optional(),
  // sent_back (mail-in only)
  returnTrackingNumber: z.string().trim().min(1).optional(),
  // cancelled
  cancellationReason: z.string().trim().min(1).optional(),
  deviceReturned: z.boolean().optional(),
});

export const jobPartBodySchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const jobPaymentBodySchema = z.object({
  kind: z.enum(['deposit', 'balance']),
  amount: z.number().int().positive(),
  tender: z.enum(['cash', 'pos1', 'pos2', 'transfer']),
});

/** The job_status enum's own values, in pipeline order (0006 + 0012). */
export const JOB_STATUS_VALUES = [
  'new',
  'in_progress',
  'waiting_approval',
  'done',
  'sent_back',
  'collected',
  'cancelled',
] as const;

/**
 * Board list filters. Param names follow the only other filtered list in this
 * API (`GET /products`: `search`, `sort` with hyphenated sort values); the
 * filter *values* are the schema's own snake_case enums verbatim, so nothing
 * has to be mapped between the board and the database.
 *
 * `status` accepts a comma-separated set — a board renders several columns at
 * once and shouldn't need one request per column.
 */
export const jobListQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        : undefined,
    )
    .refine(
      (arr) => !arr || arr.every((v) => (JOB_STATUS_VALUES as readonly string[]).includes(v)),
      { message: `status must be one or more of: ${JOB_STATUS_VALUES.join(', ')}` },
    ),
  source: z.enum(['walk_in', 'mail_in', 'online']).optional(),
  search: z.string().trim().optional(),
  sort: z.enum(['created-desc', 'created-asc', 'updated-desc']).default('created-desc'),
  ...paginationFields,
});

/** The sell_request_status enum's own values, in flow order (0007). */
export const SELL_REQUEST_STATUS_VALUES = [
  'submitted',
  'quoted',
  'accepted',
  'declined',
  'received',
  'paid',
  'rejected',
] as const;

/**
 * Trade-in staff queue filters. Same shape as the job board's: a
 * comma-separated status set so the queue can show several states at once,
 * and the schema's own enum values verbatim.
 */
export const sellRequestListQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        : undefined,
    )
    .refine(
      (arr) =>
        !arr || arr.every((v) => (SELL_REQUEST_STATUS_VALUES as readonly string[]).includes(v)),
      { message: `status must be one or more of: ${SELL_REQUEST_STATUS_VALUES.join(', ')}` },
    ),
  search: z.string().trim().optional(),
  sort: z.enum(['created-desc', 'created-asc', 'updated-desc']).default('created-desc'),
  ...paginationFields,
});

/** Mirrors apps/web's sellRequestInputSchema in field names. */
export const sellRequestBodySchema = z.object({
  deviceId: z.string().min(1).optional(),
  deviceOther: z.string().trim().optional(),
  condition: z.object({
    storage: z.string().min(1),
    screen: z.enum(['flawless', 'good', 'cracked']),
    body: z.enum(['flawless', 'good', 'worn']),
    powersOn: z.boolean(),
    network: z.enum(['unlocked', 'locked']),
    accessories: z.array(z.string()),
  }),
  name: z.string().trim().min(2),
  phone: z.string().trim().min(1),
  email: z.string().trim().email(),
  preferredContact: z.enum(['phone', 'email']),
  notes: z.string().max(1000).optional(),
});

export const sellQuoteBodySchema = z.object({
  amount: z.number().int().positive(),
});

export const sellStatusBodySchema = z.object({
  status: z.enum(['submitted', 'quoted', 'accepted', 'declined', 'received', 'paid', 'rejected']),
});

export const sellPayoutBodySchema = z.object({
  deviceLabel: z.string().trim().min(2),
  customerName: z.string().trim().min(2),
  amount: z.number().int().positive(), // stored negative — see sell.routes.ts
  method: z.enum(['cash', 'bank_transfer']),
  notes: z.string().max(500).optional(),
});

export const restockBodySchema = z.object({
  name: z.string().trim().min(2),
  category: z.enum(['cases', 'power', 'audio', 'protection', 'mounts', 'vape', 'plates']),
  resalePrice: z.number().int().positive(),
});

/* ---- B6: admin management ------------------------------------------------ */

const productCategoryEnum = z.enum([
  'cases',
  'power',
  'audio',
  'protection',
  'mounts',
  'vape',
  'plates',
]);
const productKindEnum = z.enum(['accessory', 'vape', 'plate']);

/**
 * Mirrors apps/web's productInputSchema (types/inventory.ts) in field names.
 * `supplier` stays a free-text NAME (matching the mock exactly) — resolved
 * to the real `suppliers` table by lookup-or-create in admin.routes.ts,
 * since the schema replaced the old free-typed string with a real FK. See
 * the B6 report. `buyInForm`/`images`/`tag`/`compatibility` are accepted for
 * shape compliance; several have no column to persist to (same honest-gap
 * pattern as B2) — see the report for exactly which.
 */
export const productInputBodySchema = z.object({
  name: z.string().trim().min(2),
  sub: z.string().trim().min(2),
  category: productCategoryEnum,
  kind: productKindEnum,
  price: z.number().int().positive(),
  costPrice: z.number().int().nonnegative(),
  stockQty: z.number().int().nonnegative(),
  restocking: z.boolean().optional(),
  supplier: z.string().trim().optional(),
  localBuying: z.boolean(),
  buyInForm: z.string().optional(),
  barcode: z.string().trim().optional(),
  lowStockAlert: z.boolean(),
  lowStockThreshold: z.number().int().min(1),
  description: z.string().trim().min(10),
  tag: z.string().trim().optional(),
  compatibility: z.string().trim().optional(),
  images: z.array(z.string()).optional(),
});

export const stockAdjustBodySchema = z.object({ delta: z.number().int() });
export const stockReceiveBodySchema = z.object({
  quantity: z.number().int().positive(),
  unitCost: z.number().int().nonnegative(),
});
export const stockWriteOffBodySchema = z.object({
  quantity: z.number().int().positive(),
  reason: z.string().trim().min(1),
});

export const supplierInputBodySchema = z.object({
  name: z.string().trim().min(1),
  contact: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  notes: z.string().trim().optional(),
  isActive: z.boolean().optional(),
});

// `promotionInputBodySchema` used to sit here, for the per-row promotion
// writes. Those routes are retired (see admin.routes.ts) because they could
// apply an offer to only some of its products, so the schema has gone with
// them. `unitPrice` was `.positive()` there, which also wrongly rejected a
// valid 0p tier.

/**
 * One promotion across many products, applied in a single transaction.
 * `groupId` absent = create; present = replace that promotion's rows.
 *
 * A tier's `unitPrice` may be 0 (a genuinely free item under a bulk deal) —
 * `promo_tiers.unit_price` allows it. `minQty >= 2` is the client-confirmed
 * rule that bulk pricing starts at two, and tiers always apply to multiples
 * of the SAME product — never a mixed basket.
 */
/**
 * Query for the payout ledger. `restocked` is tri-state on purpose: absent
 * means "all", so the screen can show everything, only the devices still
 * waiting to be priced for the shelf, or only the ones already on it.
 */
export const payoutListQuerySchema = z.object({
  restocked: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /**
   * The payouts belonging to one sell request.
   *
   * Needed because `search` cannot answer this: it matches a payout's OWN
   * `BUY-` reference, device label and customer name — never the sell
   * request's `FNL-` reference, which appears nowhere on the payout row. A
   * screen filtering by the request's reference would silently find nothing.
   */
  sellRequestId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
  ...paginationFields,
});

export const promotionGroupBodySchema = z.object({
  groupId: z.string().uuid().optional(),
  label: z.string().trim().optional(),
  productIds: z.array(z.string().uuid()).min(1, 'Pick at least one product'),
  tiers: z
    .array(
      z.object({
        minQty: z.number().int().min(2, 'Bulk pricing starts at 2 or more'),
        // 0 is valid (a free item under a bulk deal); below 0 would be the
        // shop paying people to take stock away.
        unitPrice: z
          .number()
          .int('A tier price must be a whole number of pence')
          .nonnegative('A tier price cannot be negative'),
      }),
    )
    .min(1, 'Add at least one tier'),
  active: z.boolean().default(true),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});

/**
 * Mirrors apps/web's StaffInput (types/staff.ts) exactly — {name, role,
 * phone, email, active} — which has no password field at all (the mock
 * never creates a real account). `password` is accepted but optional; when
 * absent, admin.routes.ts generates a secure temporary one and returns it
 * ONCE in the response, same pattern as the sell-request acceptance token.
 */
export const staffCreateBodySchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  password: z.string().min(8).optional(),
  role: z.enum(['owner', 'employee']),
  // Required (not optional) — apps/web's Staff schema requires a real,
  // validated phone on every row, matching StaffInput's own ukPhoneSchema.
  phone: z
    .string()
    .trim()
    .regex(/^(?:\+?44|0)[\d\s-]{9,13}$/, 'Enter a valid UK phone number'),
  active: z.boolean().optional(),
});

export const staffUpdateBodySchema = z.object({
  name: z.string().trim().min(2).optional(),
  role: z.enum(['owner', 'employee']).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^(?:\+?44|0)[\d\s-]{9,13}$/, 'Enter a valid UK phone number')
    .optional(),
  /**
   * `active` is the field name apps/web uses (and the one POST /admin/staff
   * already accepts on create). Update only ever read `isActive`, so the
   * roster's Active toggle sent `active`, had it silently stripped, and
   * changed nothing — a 200 that did no work. Both are accepted now;
   * `active` wins when both are sent.
   */
  active: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const staffPermissionsBodySchema = z.object({
  permissions: z.array(
    z.enum([
      'pos.operate',
      'jobs.manage',
      'inventory.manage',
      'promotions.manage',
      'cash.manage',
      'tradein.manage',
      'sales.today',
      'costs.view',
      'analytics.view',
      'payments.view',
      'reports.view',
      'returns.manage',
      'labels.manage',
      'staff.manage',
      'settings.manage',
    ]),
  ),
});

export const staffPinResetBodySchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
});

/** Mirrors apps/web's ShopSettings, extended additively — see the B6 report. */
export const settingsPatchBodySchema = z.object({
  returnWindowDays: z.number().int().nonnegative().optional(),
  idleLockMinutes: z.number().int().positive().optional(),
  floatTarget: z.number().int().nonnegative().optional(),
  shopName: z.string().trim().min(1).optional(),
  shopAddress: z.string().trim().optional(),
  shopPhone: z.string().trim().optional(),
  shopEmail: z.string().trim().email().optional(),
  openingHours: z.array(z.record(z.string(), z.unknown())).optional(),
  socialLinks: z.record(z.string(), z.unknown()).optional(),
  nextDayCutoffTime: z.string().optional(),
  belowCostPromptsForReason: z.boolean().optional(),
  idDocumentRetentionDays: z.number().int().positive().optional(),
  receiptHeaderText: z.string().trim().nullable().optional(),
  receiptFooterText: z.string().trim().nullable().optional(),
  customerEmailTemplates: z.record(z.string(), z.unknown()).optional(),
});

export const analyticsQueryBodySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
