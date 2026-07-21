# Integration guide — mock → real backend

**Audience: Raja (backend).** This is everything needed to replace the mock
data with the real API. The frontend never needs to change: components only
call TanStack Query hooks, the hooks call one `DataAdapter`, and which adapter
is live is a single env var.

---

## The one switch

```bash
# apps/web/.env.local
NEXT_PUBLIC_DATA_SOURCE=http
NEXT_PUBLIC_API_BASE_URL=https://api.fonology.co.uk
```

- `mock` (default) → in-memory fixtures, no backend needed.
- `http` → your API, via `src/lib/data/adapters/http.adapter.ts`.

No component imports an adapter directly. There is nothing else to rewire.

---

## What you implement

`src/lib/data/adapters/http.adapter.ts` is a scaffold: every method has the
correct signature and currently throws `Not implemented`. Fill each one in. The
mock (`mock.adapter.ts`) is your reference implementation — match its return
shapes exactly.

Recommended pattern (boundary-validate with the Zod schemas we already ship):

```ts
import { productSchema } from '@/lib/data/types';

async listProducts(query) {
  const res = await fetch(`${API_BASE}/products?${toQuery(query)}`);
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return z.array(productSchema).parse(await res.json());
}
```

Every entity has a Zod schema in `src/lib/data/types/` — use them to validate
responses so bad data fails loudly at the boundary, not deep in a component.

---

## The contract

Interface: `src/lib/data/adapters/types.ts` (`DataAdapter`). Types + Zod
schemas: `src/lib/data/types/`. Suggested REST mapping below — adapt verbs/paths
to your API; only the **return type** is fixed by the contract.

> **Money is integer GBP pence.** £24.00 → `2400`. **No VAT** anywhere
> (Fonology is not VAT registered — HARD RULE #3). Do not add VAT fields.

### Shop catalogue

| Method                   | Suggested endpoint                   | Returns           |
| ------------------------ | ------------------------------------ | ----------------- |
| `listProducts(query?)`   | `GET /products?category&search&sort` | `Product[]`       |
| `getProductBySlug(slug)` | `GET /products/:slug`                | `Product \| null` |
| `listCategories()`       | `GET /categories`                    | `Category[]`      |

`ProductQuery` = `{ category?, search?, sort?: 'featured'|'price-asc'|'price-desc' }`.
`getProductBySlug` returns `null` (not 404-throw) when absent.

### Repair booking

| Method                  | Suggested endpoint                           | Returns        |
| ----------------------- | -------------------------------------------- | -------------- |
| `listDevices()`         | `GET /repair/devices`                        | `Device[]`     |
| `listRepairTypes()`     | `GET /repair/types`                          | `RepairType[]` |
| `listPartTiers()`       | `GET /repair/tiers`                          | `PartTier[]`   |
| `getRepairQuote(input)` | `GET /repair/quote?deviceId&repairId&tierId` | `RepairQuote`  |
| `createBooking(input)`  | `POST /repair/bookings`                      | `Booking`      |

- **Repairs are MAIL-IN (6.4).** There is NO appointment booking — no date, no
  time slot, no `listTimeSlots`. `BookingInput` = `{ deviceId, repairId, tierId
(nullable), name, phone, email, address, postcode, preferredContact
('phone'|'email'), notes? }`. Validate with `bookingInputSchema` server-side.
  `createBooking` returns the created `Booking` incl. `reference` and `status`
  (`received | in-progress | ready | dispatched | cancelled`).
- Quote maths in the mock: `round(basePounds × deviceMultiplier)`, price `null`
  for diagnosis-only repairs (water damage, data recovery, other). Your backend
  owns real pricing — the UI just renders `RepairQuote.price` (pence, or `null`).

### Sell / trade-in (6.5)

| Method                     | Suggested endpoint    | Returns         |
| -------------------------- | --------------------- | --------------- |
| `createSellRequest(input)` | `POST /sell/requests` | `SellRequest`   |
| `listSellRequests()`       | `GET /admin/sell`     | `SellRequest[]` |

`SellRequestInput` = `{ deviceId, deviceOther?, condition, name, phone, email,
preferredContact, notes? }` where `condition = { storage, screen, body,
powersOn, network, accessories[] }`. The UI shows an INDICATIVE estimate only
(mock `computeSellEstimate`); your backend owns real trade-in pricing and sets
`SellRequest.estimate` (pence, or null) + `status`
(`received | quoted | accepted | paid | declined`). Grading fields are pending
client confirmation.

### Reviews

| Method          | Suggested endpoint | Returns    |
| --------------- | ------------------ | ---------- |
| `listReviews()` | `GET /reviews`     | `Review[]` |

### Shop orders / checkout

| Method                     | Suggested endpoint       | Returns         |
| -------------------------- | ------------------------ | --------------- |
| `createOrder(input)`       | `POST /orders`           | `Order`         |
| `getOrderByReference(ref)` | `GET /orders/:reference` | `Order \| null` |

`OrderInput` = cart `lines[]` + `name`, `email`, `fulfilment` (`collect` |
`deliver`), optional `address` (required when `deliver`). Server computes
`subtotal`, `deliveryFee` (£2.99 for delivery, else 0), `total` — **no VAT line**.

### Public tracking

| Method             | Suggested endpoint      | Returns                  |
| ------------------ | ----------------------- | ------------------------ |
| `getTracking(ref)` | `GET /track/:reference` | `TrackingResult \| null` |

`TrackingResult` is a discriminated union: `{ kind: 'booking', booking }`,
`{ kind: 'order', order }`, or `{ kind: 'sell', sell }`. Returns `null` for an
unknown reference.

### Admin read surface

| Method           | Suggested endpoint    | Returns     |
| ---------------- | --------------------- | ----------- |
| `listOrders()`   | `GET /admin/orders`   | `Order[]`   |
| `listBookings()` | `GET /admin/bookings` | `Booking[]` |

### Admin (item 7 — dashboard)

Everything below is dashboard-only. POS (item 8) will extend this same block.

| Method                       | Suggested endpoint                | Returns            |
| ---------------------------- | --------------------------------- | ------------------ |
| `getAnalytics(query)`        | `GET /admin/analytics?from&to`    | `AnalyticsSummary` |
| `listJobs()`                 | `GET /admin/jobs`                 | `Job[]`            |
| `createJob(input)`           | `POST /admin/jobs`                | `Job`              |
| `updateJob(id, patch)`       | `PATCH /admin/jobs/:id`           | `Job`              |
| `listAdminProducts()`        | `GET /admin/products`             | `AdminProduct[]`   |
| `createProduct(input)`       | `POST /admin/products`            | `AdminProduct`     |
| `updateProduct(id, input)`   | `PUT /admin/products/:id`         | `AdminProduct`     |
| `deleteProduct(id)`          | `DELETE /admin/products/:id`      | `void`             |
| `adjustStock(id, delta)`     | `POST /admin/products/:id/stock`  | `AdminProduct`     |
| `listPromotions()`           | `GET /admin/promotions`           | `Promotion[]`      |
| `createPromotion(input)`     | `POST /admin/promotions`          | `Promotion`        |
| `updatePromotion(id, input)` | `PUT /admin/promotions/:id`       | `Promotion`        |
| `deletePromotion(id)`        | `DELETE /admin/promotions/:id`    | `void`             |
| `listTransactions(query)`    | `GET /admin/transactions?from&to` | `Transaction[]`    |
| `listCashEntries()`          | `GET /admin/cash`                 | `CashEntry[]`      |
| `createCashEntry(input)`     | `POST /admin/cash`                | `CashEntry`        |
| `listRefunds()`              | `GET /admin/refunds`              | `Refund[]`         |
| `createRefund(input)`        | `POST /admin/refunds`             | `Refund`           |
| `listTradeInPayouts()`       | `GET /admin/trade-ins`            | `TradeInPayout[]`  |
| `createTradeInPayout(input)` | `POST /admin/trade-ins`           | `TradeInPayout`    |
| `listStaff()`                | `GET /admin/staff`                | `Staff[]`          |
| `createStaff(input)`         | `POST /admin/staff`               | `Staff`            |
| `updateStaff(id, input)`     | `PUT /admin/staff/:id`            | `Staff`            |
| `listLabelTemplates()`       | `GET /admin/labels`               | `LabelTemplate[]`  |
| `saveLabelTemplate(input)`   | `PUT/POST /admin/labels(/:id)`    | `LabelTemplate`    |
| `deleteLabelTemplate(id)`    | `DELETE /admin/labels/:id`        | `void`             |
| `getSettings()`              | `GET /admin/settings`             | `ShopSettings`     |
| `updateSettings(patch)`      | `PATCH /admin/settings`           | `ShopSettings`     |

Notes for the backend:

- **`getAnalytics` is aggregated server-side.** The UI never sums raw rows.
  The mock's definitions (see `src/lib/data/mock/analytics.ts`): revenue =
  Σ positive amounts, cost = Σ their recorded cost, margin = profit/revenue;
  trade-in payouts are excluded from revenue KPIs; `series` is bucketed daily
  for ranges ≤ 62 days, monthly beyond; `busiest` is a weekday×hour count
  matrix (day 0 = Monday). You own the real definitions — keep the shape.
- **`createRefund` records a RETURN, not just a refund.** `RefundInput` carries
  `source` (`order` | `counter` | `no-receipt`), a nullable `reference`, the
  `lines` that physically came back, `restock`, and `staffName`. Server-side you
  must: resolve the reference for the first two sources, reject an `amount`
  above what was paid, require `override: true` when the sale is outside the
  window OR there is no receipt, post the money out, and — when `restock` is
  true — increment stock for each line with a `productId`. Throw with a
  human-readable message; the UI shows it verbatim, so write it for the person
  at the counter.
- **`createTradeInPayout` is money OUT.** It must post a NEGATIVE transaction
  with `stream: 'trade-in'` so buy-ins are deducted from revenue for the period
  rather than reading as sales — that is the whole point of the module. If
  `sourceReference` is supplied it must match an existing `SellRequest` (and
  should move that request to `paid`). `addToStock` + `resalePrice` are the
  counter's INTENT: creating the resale listing is yours. Payout references use
  their own `BUY-` series so they can never be confused with a sale.
- **`updateJob` is called optimistically** (board drag-through). Return the
  full updated `Job`; on error the UI rolls back.
- **Jobs vs bookings:** a `Job` is the bench record; mail-in `Booking`s and
  online orders should create/link a job server-side (`source` field). The
  mock seeds them independently.
- **Uploads are UI mocks** (filenames only): product photos, the signed local
  buy-in form, plate-verification docs. When storage exists, these become
  real upload refs — the schemas already carry them as strings.
- **Promotions are till-only.** No storefront endpoint should ever serve them.
- **A promotion covers MANY products** — `productIds: Id[]`, not a single id.
  The tier quantity is evaluated PER PRODUCT: 2 of the same covered product
  hits the tier; 1 + 1 across two covered products does not. If the client
  wants mixed-basket bundles ("any 2 from this list"), that is a different
  rule and needs a decision first (logged in NOTES.md).

### Employee POS (item 8)

| Method                | Suggested endpoint | Returns        |
| --------------------- | ------------------ | -------------- |
| `completeSale(input)` | `POST /pos/sales`  | `Sale`         |
| `getTodaySummary()`   | `GET /pos/today`   | `TodaySummary` |

- **`completeSale` is the till's one write.** Validate server-side that the
  split payments sum EXACTLY to the total, deduct stock atomically, record
  each payment portion against its tender, and return the full `Sale` for
  the receipt. The mock records one transaction per portion with cost split
  pro rata; the real backend should keep line-level detail.
- **`createRefund` accepts counter-sale references** (`source: 'counter'`). The
  mock resolves them by summing the ledger rows that share the receipt
  reference, because it does not persist `Sale` records. Your backend should
  persist sales with line detail and resolve them properly — then the returns
  screen can prefill counter lines the same way it prefills online orders,
  instead of the staff adding them by hand.
- **`getTodaySummary` must return today only** — it is the single sales
  figure the employee panel is allowed (permissions.config.ts). Do not add
  history to this endpoint; history belongs to `analytics.view` endpoints.
- **Permissions:** `src/lib/permissions.config.ts` is the role→capability
  map the UI enforces. Mirror it server-side — the frontend map is UX, your
  enforcement is security.
- **Card terminals:** POS 1/2 charges go through `PaymentTerminalService`
  (`src/lib/payments/terminal.ts`), currently a manual-confirm mock. A
  Stripe Terminal adapter implements the same interface. Receipts print via
  `PrintService` (`src/lib/print/print-service.ts`), currently the browser
  dialog; the local thermal-printer agent implements the same interface.

### Auth (item 9 — likely Supabase Auth)

| Method                        | Returns            |
| ----------------------------- | ------------------ |
| `getSession()`                | `AuthUser \| null` |
| `signIn(input)`               | `AuthUser`         |
| `signUp(input)`               | `AuthUser`         |
| `signInWithGoogle()`          | `AuthUser`         |
| `staffSignIn(input)`          | `AuthUser`         |
| `requestPasswordReset(email)` | `void`             |
| `signOut()`                   | `void`             |

- The UI only touches the `useAuth` hooks (`use-auth.ts`) — implement these
  seven adapter methods over Supabase and everything works unchanged.
- `AuthUser.staffRole` drives the permissions map for staff sessions; keep
  it authoritative server-side.
- **Customer accounts are OPTIONAL by business rule** — no storefront flow
  may ever require a session. Don't add auth guards to shop/repair/sell/track
  endpoints.

---

## Error handling

- Throw on non-2xx; TanStack Query surfaces it to the UI's error/empty states.
- "Not found" lookups (`getProductBySlug`, `getOrderByReference`, `getTracking`)
  return `null` — they do **not** throw.
- Consider a shared `ApiError` carrying status + body for consistent handling.

## Auth

Auth implementation is yours. When protected endpoints exist, add credential
handling inside `http.adapter.ts` (e.g. `credentials: 'include'` or a bearer
token from the session). No component or hook changes required.

## `packages/contracts`

`src/lib/data/types/` is deliberately framework-free (Zod only) so it can move
into a shared `packages/contracts` workspace that both `apps/web` and your
`apps/api` import — one source of truth for request/response shapes. The
monorepo (Turborepo + pnpm workspaces) is already set up for you to add
`apps/api` and `packages/*` without restructuring.
