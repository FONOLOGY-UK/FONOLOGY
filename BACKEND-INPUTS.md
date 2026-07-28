# Backend inputs — extracted from the mock layer

Extraction only. Nothing here is invented or improved beyond what
`apps/web/src` actually contains; anything not determinable from the code is
marked `UNRESOLVED IN CODE`. No file was modified to produce this document.
Source of truth for every claim: `src/lib/data/adapters/types.ts` (the
contract), `src/lib/data/types/*.ts` (schemas), `src/lib/data/adapters/mock.adapter.ts`
(behaviour), `src/lib/permissions.config.ts`, `src/lib/config.ts`,
`src/lib/payments/*`, `src/lib/print/*`, and the route tree under `src/app`.

---

## 1. The adapter interface (API surface)

Interface: `DataAdapter`, `src/lib/data/adapters/types.ts:64-195`. Every
method is async. Grouped by resource; **bold** = write.

### Shop catalogue

| Method             | Params (required unless marked)                                 | Returns           | R/W |
| ------------------ | --------------------------------------------------------------- | ----------------- | --- |
| `listProducts`     | `query?: ProductQuery` (optional: `category`, `search`, `sort`) | `Product[]`       | R   |
| `getProductBySlug` | `slug: string`                                                  | `Product \| null` | R   |
| `listCategories`   | —                                                               | `Category[]`      | R   |

### Repair booking

| Method              | Params                                                      | Returns        | R/W            |
| ------------------- | ----------------------------------------------------------- | -------------- | -------------- |
| `listDevices`       | —                                                           | `Device[]`     | R              |
| `listRepairTypes`   | —                                                           | `RepairType[]` | R              |
| `listPartTiers`     | —                                                           | `PartTier[]`   | R              |
| `getRepairQuote`    | `{ deviceId, repairId, tierId: PartTierId }` (all required) | `RepairQuote`  | R, **derived** |
| **`createBooking`** | `input: BookingInput`                                       | `Booking`      | W              |

`getRepairQuote` is flagged derived: it computes `price` from `device × repairType.base[tier]` at call time (see §8) — nothing is persisted by this call. It is a pricing calculator, not a table lookup.

### Sell / trade-in

| Method                  | Params                    | Returns         | R/W |
| ----------------------- | ------------------------- | --------------- | --- |
| **`createSellRequest`** | `input: SellRequestInput` | `SellRequest`   | W   |
| `listSellRequests`      | —                         | `SellRequest[]` | R   |

`createSellRequest` also computes `estimate` server-side from `computeSellEstimate` (derived, see §8) — the estimate is stored on the record but is generated, not submitted by the client.

### Reviews

| Method        | Params | Returns    | R/W |
| ------------- | ------ | ---------- | --- |
| `listReviews` | —      | `Review[]` | R   |

### Shop orders / checkout

| Method                | Params              | Returns         | R/W |
| --------------------- | ------------------- | --------------- | --- |
| **`createOrder`**     | `input: OrderInput` | `Order`         | W   |
| `getOrderByReference` | `reference: string` | `Order \| null` | R   |

`createOrder` derives `subtotal`, `deliveryFee`, `discount`, `total`, `status` server-side (see §8) — the client only submits lines + customer/delivery details.

### Public tracking

| Method        | Params              | Returns                  | R/W                                                      |
| ------------- | ------------------- | ------------------------ | -------------------------------------------------------- |
| `getTracking` | `reference: string` | `TrackingResult \| null` | R, **derived** (fan-out lookup across 3 tables — see §7) |

### Admin read surface (dashboard-only)

| Method         | Params | Returns     | R/W |
| -------------- | ------ | ----------- | --- |
| `listOrders`   | —      | `Order[]`   | R   |
| `listBookings` | —      | `Booking[]` | R   |

### Analytics

| Method         | Params                                               | Returns            | R/W                           |
| -------------- | ---------------------------------------------------- | ------------------ | ----------------------------- |
| `getAnalytics` | `query: AnalyticsQuery { from, to }` (both required) | `AnalyticsSummary` | R, **fully derived** — see §8 |

### Jobs (bench pipeline)

| Method          | Params                    | Returns | R/W                                                |
| --------------- | ------------------------- | ------- | -------------------------------------------------- |
| `listJobs`      | —                         | `Job[]` | R                                                  |
| **`createJob`** | `input: JobInput`         | `Job`   | W                                                  |
| **`updateJob`** | `id: Id, patch: JobPatch` | `Job`   | W — called optimistically (UI rolls back on error) |

### Inventory

| Method              | Params                        | Returns          | R/W                              |
| ------------------- | ----------------------------- | ---------------- | -------------------------------- |
| `listAdminProducts` | —                             | `AdminProduct[]` | R                                |
| **`createProduct`** | `input: ProductInput`         | `AdminProduct`   | W                                |
| **`updateProduct`** | `id: Id, input: ProductInput` | `AdminProduct`   | W                                |
| **`deleteProduct`** | `id: Id`                      | `void`           | W                                |
| **`adjustStock`**   | `id: Id, delta: number`       | `AdminProduct`   | W — no reason captured (see §13) |

### Promotions (till-only)

| Method                | Params                          | Returns       | R/W |
| --------------------- | ------------------------------- | ------------- | --- |
| `listPromotions`      | —                               | `Promotion[]` | R   |
| **`createPromotion`** | `input: PromotionInput`         | `Promotion`   | W   |
| **`updatePromotion`** | `id: Id, input: PromotionInput` | `Promotion`   | W   |
| **`deletePromotion`** | `id: Id`                        | `void`        | W   |

### Payments / cash / refunds

| Method                | Params                               | Returns         | R/W                                                      |
| --------------------- | ------------------------------------ | --------------- | -------------------------------------------------------- |
| `listTransactions`    | `query: AnalyticsQuery { from, to }` | `Transaction[]` | R                                                        |
| `listCashEntries`     | —                                    | `CashEntry[]`   | R                                                        |
| **`createCashEntry`** | `input: CashEntryInput`              | `CashEntry`     | W                                                        |
| `listRefunds`         | —                                    | `Refund[]`      | R                                                        |
| **`createRefund`**    | `input: RefundInput`                 | `Refund`        | W, **derived validation** (window/amount check — see §8) |

### Trade-ins / buy-ins

| Method                    | Params                      | Returns           | R/W |
| ------------------------- | --------------------------- | ----------------- | --- |
| `listTradeInPayouts`      | —                           | `TradeInPayout[]` | R   |
| **`createTradeInPayout`** | `input: TradeInPayoutInput` | `TradeInPayout`   | W   |

### Staff

| Method            | Params                      | Returns   | R/W |
| ----------------- | --------------------------- | --------- | --- |
| `listStaff`       | —                           | `Staff[]` | R   |
| **`createStaff`** | `input: StaffInput`         | `Staff`   | W   |
| **`updateStaff`** | `id: Id, input: StaffInput` | `Staff`   | W   |

### Label templates

| Method                    | Params                                    | Returns           | R/W                               |
| ------------------------- | ----------------------------------------- | ----------------- | --------------------------------- |
| `listLabelTemplates`      | —                                         | `LabelTemplate[]` | R                                 |
| **`saveLabelTemplate`**   | `input: LabelTemplateInput & { id?: Id }` | `LabelTemplate`   | W — upsert: `id` present = update |
| **`deleteLabelTemplate`** | `id: Id`                                  | `void`            | W                                 |

### Settings

| Method               | Params                                           | Returns        | R/W |
| -------------------- | ------------------------------------------------ | -------------- | --- |
| `getSettings`        | —                                                | `ShopSettings` | R   |
| **`updateSettings`** | `patch: ShopSettingsPatch` (all fields optional) | `ShopSettings` | W   |

### Employee POS

| Method             | Params             | Returns        | R/W                                                                  |
| ------------------ | ------------------ | -------------- | -------------------------------------------------------------------- |
| **`completeSale`** | `input: SaleInput` | `Sale`         | W, **derived validation** (split-payment sum, stock deduct — see §8) |
| `getTodaySummary`  | —                  | `TodaySummary` | R, **fully derived**                                                 |

### Auth (UI-only; Raja backs with real auth)

| Method                     | Params                                         | Returns            | R/W                                        |
| -------------------------- | ---------------------------------------------- | ------------------ | ------------------------------------------ |
| `getSession`               | —                                              | `AuthUser \| null` | R                                          |
| **`signIn`**               | `input: SignInInput { email, password }`       | `AuthUser`         | W                                          |
| **`signUp`**               | `input: SignUpInput { name, email, password }` | `AuthUser`         | W                                          |
| **`signInWithGoogle`**     | —                                              | `AuthUser`         | W                                          |
| **`staffSignIn`**          | `input: SignInInput`                           | `AuthUser`         | W — matches roster **by email**, mock only |
| **`requestPasswordReset`** | `email: string`                                | `void`             | W (mock: always succeeds, no-op)           |
| **`signOut`**              | —                                              | `void`             | W                                          |

**Derived-not-stored methods** (become computed endpoints, not tables): `getRepairQuote`, `getAnalytics`, `getTodaySummary`, and the estimate half of `createSellRequest`. `getTracking` is a derived fan-out read (not a table of its own — see §7).

---

## 2. Entity shapes (schema draft)

Money = integer GBP pence everywhere (`moneySchema = z.number().int()`, `src/lib/data/types/pricing.ts:23`). **No entity in this codebase has a float or string money field** — this rule holds with no exceptions found.

Dates: two formats only. `isoDateTimeSchema` = full ISO-8601 with offset (`common.ts:14`, e.g. `2026-07-18T09:30:00.000Z`), used for `createdAt`/`updatedAt`/`at` fields. `isoDateSchema` = `YYYY-MM-DD` (`common.ts:17`), used for calendar-day fields (`CashEntry.date`, `AnalyticsQuery.from/to`, `TodaySummary.date`, `Staff.startedAt`). `Order.createdAt`, `Booking.createdAt`, `SellRequest.createdAt` are typed as plain `z.string()` rather than `isoDateTimeSchema` specifically — **inconsistent typing, not inconsistent format** (mock always writes `new Date().toISOString()` into them); worth tightening to `isoDateTimeSchema` server-side.

### Product / Category (`product.ts`)

- `Product`: `id`(ref), `slug`, `name`, `sub`, `category`(enum ref, embedded string id not FK object), `kind`(enum), `price`(money), `stockStatus`(enum, 3-state, **never a raw count client-side**), `tag`(nullable), `compatibility`(nullable), `description`, `highlights: string[]`(embedded array), `specs: {label,value}[]`(embedded array of objects — a join table server-side), `images: string[]` (each `.url()`-constrained), `art`(enum, display-only), `tile`(enum, display-only).
- `Category`: `id` (`'all'` literal ∪ `productCategoryIdSchema`), `label`.
- Constraints: `slug`/`name` min 1 char; `productCategoryIdSchema` enum = `cases|power|audio|protection|mounts|vape|plates`; `productKindSchema` enum = `accessory|vape|plate`; `images[]` each must be a valid URL.

### AdminProduct / StockMeta (`inventory.ts`)

`AdminProduct = Product ⊕ StockMeta`. `StockMeta`: `costPrice`(money), `stockQty`(int ≥0), `supplier`(nullable string), `localBuying`(bool), `buyInForm`(nullable string — upload ref), `barcode`(nullable string). `ProductInput` (create/edit form) has its own constraints: `name`/`sub` min 2, `price` positive, `costPrice` ≥0, `stockQty` ≥0, `description` min 10 chars, plus two cross-field `.refine()`s: supplier required unless `localBuying`, `buyInForm` required when `localBuying`.

### Booking / Device / RepairType / PartTier (`repair.ts`)

- `Device`: `id`(ref), `name`, `brand`(enum `apple|samsung|pixel|other`), `priceMultiplier`(positive number — **not money**, a scalar).
- `RepairType`: `id`(ref), `name`, `desc`, `time`(free text, e.g. "40–60 min"), `base: TierPrices | null` — `TierPrices = {original,oem,copy}` all money, or `null` for diagnosis-only. **Embedded object, not a join** — three tier prices live inline on the repair type.
- `PartTier`: `id`(`partTierIdSchema` enum `original|oem|copy`), `name`, `strap`, `line`, `warranty` — all display copy.
- `RepairQuote` (derived, not persisted): `deviceId`(ref), `repairId`(ref), `tierId`(ref), `price`(money, nullable), `warranty`, `estTime`.
- `Booking`: extends `BookingInput` (`deviceId`(ref), `repairId`(ref), `tierId`(ref, nullable), `name`, `phone`(UK regex), `email`, `address`(min 4), `postcode`(UK regex), `preferredContact`(enum `phone|email`), `notes?`(max 1000)) + `id`, `reference`, `status`(enum), `price`(money, nullable), `createdAt`(string).

### SellRequest / SellCondition (`sell.ts`)

`SellCondition` (embedded object, not a join): `storage`(free string, min 1), `screen`(enum `flawless|good|cracked`), `body`(enum `flawless|good|worn`), `powersOn`(bool), `network`(enum `unlocked|locked`), `accessories: string[]`(embedded array, free text). `SellRequest` extends `SellRequestInput` (`deviceId`(ref), `deviceOther?`, `condition`, `name`, `phone`, `email`, `preferredContact`, `notes?`) + `id`, `reference`, `status`(enum), `estimate`(money, nullable), `createdAt`.

### Order / CartLine (`order.ts`)

`CartLine` (embedded array on `Order`, not a normalized join in the current schema — see §13): `productId`(ref), `name`, `sub`, `slug`, `kind`(enum, denormalized copy of the product's kind at add-to-cart time), `unitPrice`(money, **price snapshot at time of adding** — not a live product lookup), `quantity`(positive int). `Order`: `id`, `reference` (`"FNL-nnnn"`), `lines: CartLine[]`, `name`, `email`, `phone`, `delivery`(enum), `address`(nullable), `postcode`(nullable), `subtotal`/`deliveryFee`/`discount`/`total`(all money), `status`(enum), `createdAt`. `OrderVerification` (embedded, nullable on `OrderInput`): `registrationDoc`, `licence` — both bare filename/storage-ref strings, no MIME type, no size, no upload timestamp captured in the schema.

### Job (`job.ts`)

`Job` extends `JobInput` (`customerName`(min 2), `phone`(UK regex), `email?`, `device`(free text, min 2 — **not** a `deviceId` ref; walk-ins bring anything), `problem`(min 3), `notes?`(max 1000), `quote`(money, nullable), `payment`(enum)) + `id`, `reference`, `status`(enum), `source`(enum `walk-in|mail-in|online`), `createdAt`, `updatedAt`. No field links a `Job` to a `Booking` or `Order` even when `source` is `mail-in`/`online` — the doc comments (`job.ts:11-12`, `INTEGRATION.md:199-201`) say this linking is the backend's job to add.

### Sale / SaleLine (`pos.ts`)

`SaleLine` (embedded array): `productId`(ref), `name`, `sub`, `quantity`(positive int), `unitPrice`(money — actual charged price), `listPrice`(money — shelf price, for "you saved" copy), `costPrice`(money, snapshot), `tierApplied`(bool). `SalePayment` (embedded array): `tender`(enum), `amount`(money, positive). `Sale`: `id`, `reference`, `lines: SaleLine[]`, `subtotal`/`discount`/`total`/`cost`(money), `payments: SalePayment[]`, `at`. **No staff/customer reference field anywhere on `Sale`** — see §13.

### Promotion (`promotion.ts`)

`Promotion`: `id`, `name`, `productIds: Id[]`(embedded array of refs — many-to-many, no join table modeled), `tiers: PromoTier[]`(embedded array; `PromoTier = {minQty≥2, unitPrice: money>0}`), `active`(bool), `createdAt`.

### Transaction / CashEntry / Refund / TradeInPayout (`finance.ts`)

- `Transaction`: `id`, `at`, `stream`(enum `shop|repair|trade-in`), `reference`(free string, correlates to Order/Job/Sale/TradeInPayout by value, **not a typed/enforced FK**), `description`, `amount`(money, signed — negative = money out), `cost`(money), `tender`(enum, 5 values), `category`(nullable enum ref). This is the single ledger table everything else derives from.
- `CashEntry`: `date`(day), `kind`(enum `float-open|petty-in|petty-out`), `amount`(money, always positive — sign comes from `kind`), `note`(min 2), `staffName`(free text, min 1 — **not a Staff ref**), + `id`, `at`.
- `Refund`: extends `RefundInput` (`source`(enum), `reference`(nullable string), `lines: ReturnLine[]`(embedded array; `ReturnLine = {productId: ref|null, name, quantity, unitPrice: money}`), `amount`(money, positive), `reason`(min 3), `tender`(enum — **not constrained to match the original sale's tender**), `restock`(bool), `staffName`(free text), `override`(bool)) + `id`, `at`, `withinWindow`(bool, computed at write time and stored).
- `TradeInPayout`: extends `TradeInPayoutInput` (`deviceLabel`(min 2), `sourceReference`(nullable, free text matched against `SellRequest.reference`), `customerName`(min 2), `amount`(money, positive), `tender`(enum), `staffName`(free text), `notes?`(max 500), `addToStock`(bool), `resalePrice`(money, nullable)) + `id`, `reference` (own `"BUY-nnnn"` series), `at`.

### Staff (`staff.ts`)

`Staff` extends `StaffInput` (`name`(min 2), `role`(enum `owner|manager|technician|counter`), `phone`(UK regex), `email`, `active`(bool)) + `id`, `startedAt`(day). No password/PIN field on `Staff` — auth credentials are entirely out of this schema (mock `staffSignIn` matches by email only, no password check — see §7).

### ShopSettings (`settings.ts`)

Flat object: `returnWindowDays`(int ≥0), `lowStockThreshold`(int ≥0), `idleLockMinutes`(int ≥1), `adminPin`(string, regex `^\d{4}$`), `floatTarget`(money). No per-field audit (who changed what, when).

### AnalyticsSummary (`analytics.ts`) — fully derived, see §8

`range`(embedded query), `bucket`(enum `day|month`), `revenue/cost/profit/avgSale/prevRevenue/prevProfit`(money), `margin`(0–1 float — the **one** legitimate non-money-schema numeric field, since it's a ratio not currency), `sales`(int), `series: RevenuePoint[]`, `byCategory: CategoryRevenue[]`, `busiest: BusyCell[]`, `byTender: TenderTotal[]` — all four embedded arrays, all recomputed per query, none persisted independently.

### AuthUser / LabelTemplate / Review / TrackingResult

- `AuthUser`: `id`, `name`, `email`, `kind`(enum `customer|staff`), `staffRole`(enum, nullable — set only for staff). See §7.
- `LabelTemplate`: `name`, `lines: LabelLine[]`(embedded, max 6; `LabelLine = {text, size: enum, bold: bool}`), `barcode`(nullable string) + `id`, `updatedAt`.
- `Review`: `id`, `name`, `device`, `text`, `rating`(int 1–5).
- `TrackingResult`: discriminated union on `kind` (`booking|order|sell`), each variant embeds the full entity — not a lightweight status projection.

---

## 3. Enums and state machines

| Field                                                 | Values                                                                                         | Reachable transitions per UI                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JobStatus` (`job.ts:17`)                             | `new → in-progress → done → collected`                                                         | Linear only, one direction. `nextJobStatus()` (`job.ts:37-41`) returns the single next step or `null` at the end — **no code path moves a job backward**. Advanced via `updateJob` from the Jobs board/sheet; gated by `jobs.manage` (both roles have it).                                                                                                                                                                                                          |
| `JobPayment`                                          | `unpaid \| paid-advance \| paid`                                                               | No enforced sequence — `JobPatch` allows setting any value at any time; UI (job-sheet) presumably offers all three as a free select. Same permission as status.                                                                                                                                                                                                                                                                                                     |
| `JobSource`                                           | `walk-in \| mail-in \| online`                                                                 | Set once at creation (`createJob` always writes `'walk-in'`; mail-in/online sourcing is a backend-side responsibility per `INTEGRATION.md:199`), never changed after.                                                                                                                                                                                                                                                                                               |
| `OrderStatus` (`order.ts:65`)                         | `pending, paid, ready, collected, shipped, cancelled`                                          | Mock `createOrder` always writes `'paid'` immediately (`mock.adapter.ts:167`) — **no code path transitions an order through any other status**; the rest of the enum is contract-only, unused by the mock. No admin screen edits order status.                                                                                                                                                                                                                      |
| `BookingStatus` (`repair.ts:96`)                      | `received, in-progress, ready, dispatched, cancelled`                                          | Mock `createBooking` always writes `'received'`. No mutation method exists for bookings at all (`DataAdapter` has no `updateBooking`) — status changes for mail-in repairs are entirely unimplemented in the frontend contract.                                                                                                                                                                                                                                     |
| `SellStatus` (`sell.ts:47`)                           | `received, quoted, accepted, paid, declined`                                                   | Mock `createSellRequest` always writes `'received'`. Same gap: **no `updateSellRequest` method exists** — nothing in the contract can move a sell request forward. `createTradeInPayout` is documented to move a linked request to `'paid'` (`INTEGRATION.md:193-194`) but the mock adapter does **not** actually do this (`mock.adapter.ts:467-500` never touches `mockDb.sellRequests` status) — doc/code mismatch, backend must implement the transition itself. |
| `PosTender` / `Tender` (`pos.ts:11`, `finance.ts:15`) | POS: `cash, pos1, pos2, transfer`. Ledger: adds `stripe` (online-only, never a POS selection). | Free choice at point of sale/refund/payout; no role restricts which tenders a role may use.                                                                                                                                                                                                                                                                                                                                                                         |
| `ReturnSource`                                        | `order \| counter \| no-receipt`                                                               | Determines which lookup `createRefund` performs (see §8); no transitions, chosen once per refund.                                                                                                                                                                                                                                                                                                                                                                   |
| `StaffRole` (`staff.ts:10`)                           | `owner, manager, technician, counter`                                                          | No promotion/demotion workflow — `updateStaff` allows any role change with no audit. Permission mapping is static per role (see §4), not per-transition.                                                                                                                                                                                                                                                                                                            |
| `ProductKind`                                         | `accessory \| vape \| plate`                                                                   | Fixed at creation via `ProductInput.kind`; editable via `updateProduct` with no restriction (e.g. nothing stops turning an `accessory` into a `vape` after sale history exists).                                                                                                                                                                                                                                                                                    |
| `StockStatus`                                         | `in-stock \| out-of-stock \| restocking`                                                       | **Never set directly** — always derived via `deriveStockStatus(stockQty, restocking)` (`inventory.ts:72-75`): `stockQty > 0 → in-stock`, else `restocking` flag decides between `restocking`/`out-of-stock`. This is a pure function of two other fields, not independent state.                                                                                                                                                                                    |
| `PartTierId`                                          | `original \| oem \| copy`                                                                      | Not a lifecycle — a repair-quality selector, fixed per quote/booking.                                                                                                                                                                                                                                                                                                                                                                                               |
| `DeliveryMethod`                                      | `collect \| standard \| next-day \| remote`                                                    | Chosen once at checkout; rates in `lib/config.ts` (see §8).                                                                                                                                                                                                                                                                                                                                                                                                         |

---

## 4. Permissions

Full contents of `src/lib/permissions.config.ts` are reproduced by reference above (§ already read in full during extraction — key structures):

```ts
export type Permission =
  | 'pos.operate'
  | 'jobs.manage'
  | 'inventory.manage'
  | 'promotions.manage'
  | 'cash.manage'
  | 'tradein.manage'
  | 'sales.today'
  | 'costs.view'
  | 'analytics.view'
  | 'payments.view'
  | 'reports.view'
  | 'returns.manage'
  | 'labels.manage'
  | 'staff.manage'
  | 'settings.manage';
```

### Role × permission matrix

| Permission          | owner | manager | technician | counter |
| ------------------- | ----- | ------- | ---------- | ------- |
| `pos.operate`       | ✅    | ✅      | ✅         | ✅      |
| `jobs.manage`       | ✅    | ✅      | ✅         | ✅      |
| `inventory.manage`  | ✅    | ✅      | ✅         | ✅      |
| `promotions.manage` | ✅    | ✅      | ✅         | ✅      |
| `cash.manage`       | ✅    | ✅      | ✅         | ✅      |
| `tradein.manage`    | ✅    | ✅      | ✅         | ✅      |
| `sales.today`       | ✅    | ✅      | ✅         | ✅      |
| `costs.view`        | ✅    | ✅      | ❌         | ❌      |
| `analytics.view`    | ✅    | ✅      | ❌         | ❌      |
| `payments.view`     | ✅    | ✅      | ❌         | ❌      |
| `reports.view`      | ✅    | ✅      | ❌         | ❌      |
| `returns.manage`    | ✅    | ✅      | ❌         | ❌      |
| `labels.manage`     | ✅    | ✅      | ❌         | ❌      |
| `staff.manage`      | ✅    | ✅      | ❌         | ❌      |
| `settings.manage`   | ✅    | ✅      | ❌         | ❌      |

`technician` and `counter` are, today, identical (both get exactly `EMPLOYEE_PERMISSIONS`) — the role distinction currently carries no behavioural difference anywhere in `permissions.config.ts`.

### POS tabs (derived from the matrix)

`POS_TABS` (`permissions.config.ts:78-85`): Checkout→`pos.operate`, Jobs→`jobs.manage`, Inventory→`inventory.manage`, Promotions→`promotions.manage`, Cash→`cash.manage`, Trade-ins→`tradein.manage`. All six resolve `true` for every role today (all are `EMPLOYEE_PERMISSIONS`), so in practice **every POS tab is visible to every staff role** — the matrix currently has no effect on the POS tab bar, only on the `/admin` capabilities.

### Every permission-check call site

- `lib/permissions.config.ts:67-69` — `can(role, permission)`, the primitive.
- `components/shared/can.tsx:26-38` — `<Can role do fallback>`, inline UI guard; also defines `useStaffRole(fallback)` (`can.tsx:19-23`), which reads the mock session and **falls back to a hardcoded role when there is no session** — `'owner'` is passed as the fallback wherever the admin shell calls it, `'counter'` wherever the POS shell/route-guard calls it (`pos-shell.tsx:25`, `route-guard.tsx:22`). This means **an unauthenticated visitor to `/admin` is treated as an owner** by the client-side logic.
- `components/pos/route-guard.tsx:15-39` — `<RouteGuard permission>`, page-level guard, used to wrap **every** `/pos/*` sub-page (`app/(pos)/pos/{jobs,inventory,cash,promotions,trade-ins}/page.tsx`, and presumably `pos/page.tsx` itself for `pos.operate`).
- `components/pos/pos-shell.tsx:30,62` — filters `POS_TABS` by `can(role, tab.permission)` and gates the today's-total display by `can(role, 'sales.today')`.
- `components/auth/staff-login-view.tsx` — references `can`/permission types for post-login routing context.

### Screens/actions with no permission check

**Every `/admin/*` route** (`app/(dashboard)/admin/**/page.tsx` — cash, inventory, jobs, labels, overview, payments, promotions, reports, returns, settings, staff, trade-ins) — confirmed by direct inspection of `app/(dashboard)/admin/layout.tsx:12-14` (renders `<AdminShell>` with no guard) and every admin `page.tsx` (e.g. `app/(dashboard)/admin/returns/page.tsx` renders `<ReturnsView />` directly, no `RouteGuard` equivalent). A grep for `can(|<Can|RouteGuard` across `components/admin/**` returns **zero matches** — none of the admin view components hide or gate any control by role either. Combined with the `useStaffRole('owner')` fallback above, the entire admin dashboard is reachable and fully operable by anyone who can load the URL, with no client-side distinction between owner/manager/technician/counter, or between a signed-in and signed-out visitor. `INTEGRATION.md:233-235` already tells Raja this is UX only and must be re-enforced server-side — but the asymmetry between POS (gated) and Admin (ungated) inside the same mock is worth Raja knowing explicitly, since it means **zero reference implementation exists in this repo for admin-side permission enforcement** to mirror — only the POS pattern (`RouteGuard`) does.

---

## 5. Routes → data

### `(storefront)` — public

| Route                                                                                          | Adapter calls (via hooks unless noted)                                                                                                                                             | Notes                                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                                                            | `useReviews` (Reviews section), `useProducts` (ShopStrip), `useDevices`+`useRepairTypes` (QuickQuote)                                                                              | Hero/Teardown/WhyStats/Manifesto/CtaBand render static copy — no adapter call                                                                 |
| `/shop`                                                                                        | `useCategories`, `useProducts` (`shop-catalog.tsx`)                                                                                                                                |                                                                                                                                               |
| `/shop/[slug]`                                                                                 | `dataAdapter.getProductBySlug`, `.listCategories`, `.listProducts` — called **directly** in the server component (`app/(storefront)/shop/[slug]/page.tsx:27,44,49`), not via hooks | Only server-component route that bypasses the hook layer; also drives `generateStaticParams`/`generateMetadata`                               |
| `/repair`                                                                                      | `useDevices`, `usePartTiers`, `useRepairTypes`, `useCreateBooking` (`repair-flow.tsx`)                                                                                             |                                                                                                                                               |
| `/sell`                                                                                        | `useDevices`, `useCreateSellRequest` (`sell-flow.tsx`)                                                                                                                             |                                                                                                                                               |
| `/cart`                                                                                        | `useProducts` (via `cart-drawer.tsx`/cart view — cart contents themselves are Zustand client state, not fetched)                                                                   |                                                                                                                                               |
| `/checkout`                                                                                    | `useCreateOrder` (`checkout-flow.tsx`)                                                                                                                                             |                                                                                                                                               |
| `/checkout/confirmation`                                                                       | reads `?ref=` query param → `ConfirmationView` (not traced further; presumably `useOrder`)                                                                                         |                                                                                                                                               |
| `/track`                                                                                       | `useDevices`, `useRepairTypes`, `useTracking` (`track-request.tsx`)                                                                                                                |                                                                                                                                               |
| `/terms`, `/privacy`, `/returns-policy`, `/shipping`, `/cookies`, `/about`, `/contact`, `/faq` | **none**                                                                                                                                                                           | All render `<ContentPlaceholder>` — flagged static/placeholder per `CONTENT-TODO.md`, confirmed no adapter import in any of these route files |
| `/returns`                                                                                     | —                                                                                                                                                                                  | Permanent redirect to `/returns-policy`, no data                                                                                              |

### `(auth)`

| Route              | Adapter calls                  |
| ------------------ | ------------------------------ |
| `/login`           | `useSignIn`, `useGoogleSignIn` |
| `/register`        | `useSignUp`, `useGoogleSignIn` |
| `/forgot-password` | `useRequestPasswordReset`      |
| `/staff-login`     | `useStaffSignIn`               |

### `(dashboard)/admin` — all ungated (§4)

| Route               | Adapter calls                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/admin` (overview) | `useAdminProducts`, `useAnalytics`, `useJobs`, `useSettings`                                                            |
| `/admin/jobs`       | `useJobs`, `useCreateJob`, `useUpdateJob`                                                                               |
| `/admin/inventory`  | `useAdminProducts`, `useAdjustStock`, `useDeleteProduct`, `useSettings`, (dialog) `useCreateProduct`/`useUpdateProduct` |
| `/admin/promotions` | `useAdminProducts`, `usePromotions`, `useCreatePromotion`, `useUpdatePromotion`, `useDeletePromotion`                   |
| `/admin/payments`   | `useAnalytics`, `useTransactions`                                                                                       |
| `/admin/cash`       | `useCashEntries`, `useCreateCashEntry`, `useSettings`, `useStaff`                                                       |
| `/admin/returns`    | `useAdminProducts`, `useOrder`, `useRefunds`, `useCreateRefund`, `useSettings`                                          |
| `/admin/trade-ins`  | `useSellRequests`, `useTradeInPayouts`, `useCreateTradeInPayout`                                                        |
| `/admin/staff`      | `useStaff`, `useCreateStaff`, `useUpdateStaff`                                                                          |
| `/admin/labels`     | `useLabelTemplates`, `useSaveLabelTemplate`, `useDeleteLabelTemplate`                                                   |
| `/admin/reports`    | `useAnalytics`                                                                                                          |
| `/admin/settings`   | `useSettings`, `useUpdateSettings`                                                                                      |

### `(pos)/pos` — all wrapped in `RouteGuard`

| Route             | Permission          | Adapter calls                                          | Notes                                                                         |
| ----------------- | ------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `/pos`            | `pos.operate`       | `useAdminProducts`, `usePromotions`, `useCompleteSale` |                                                                               |
| `/pos/jobs`       | `jobs.manage`       | reuses `JobsView` (same as `/admin/jobs`)              |                                                                               |
| `/pos/inventory`  | `inventory.manage`  | reuses `InventoryView hideCosts`                       | costs hidden by prop, not by a separate permission check on individual fields |
| `/pos/cash`       | `cash.manage`       | reuses `CashView`                                      |                                                                               |
| `/pos/promotions` | `promotions.manage` | reuses `PromotionsView`                                |                                                                               |
| `/pos/trade-ins`  | `tradein.manage`    | reuses `TradeInsView compact`                          | drops month-to-date tile only                                                 |

No `/pos` route reuses `/admin/returns`, `/admin/staff`, `/admin/payments`, `/admin/reports`, `/admin/settings`, or `/admin/labels` — consistent with those permissions being management-only.

---

## 6. Hardware service interfaces

### `PaymentTerminalService` (`src/lib/payments/terminal.ts`)

```ts
export type TerminalOutcome = 'approved' | 'cancelled';
export interface TerminalCharge {
  result: Promise<TerminalOutcome>;
  confirm: () => void; // mock-only manual approval
  cancel: () => void;
}
export interface PaymentTerminalService {
  charge(amount: Money, terminal: 'pos1' | 'pos2'): TerminalCharge;
}
```

Mock behaviour: `charge()` immediately returns a `TerminalCharge` whose `result` promise is unsettled until the UI calls `confirm()` (resolves `'approved'`) or `cancel()` (resolves `'cancelled'`) — i.e. the mock simulates "waiting for card…" with manual buttons. UI expects on success: proceed to record the sale with `tender: 'pos1'|'pos2'`. On failure/cancel: abandon that payment portion, no partial state persisted (nothing written until `completeSale` is called). A real Stripe Terminal adapter is expected to resolve `result` itself from hardware and make `confirm()` a no-op.

### `PrintService` (`src/lib/print/print-service.ts`)

```ts
export interface PrintService {
  printReceipt(): void; // prints the mounted `.print-area` DOM node
  kickDrawer(): void; // no-op until a local agent exists
}
```

Mock: `printReceipt` calls `window.print()`; `kickDrawer` is an intentional no-op (comment: "Thermal-agent territory — nothing a browser can do"). UI expects: the receipt component (`components/pos/receipt.tsx`) is already mounted with class `.print-area` before `printReceipt()` is called; no error path is modeled (no printer-offline/paper-out signal exists in the interface).

### `PaymentProvider` (`src/lib/payments/provider.ts`) — online checkout, distinct from the till

```ts
export type PaymentMethodId = 'stripe' | 'clearpay';
export interface PaymentResult {
  ok: boolean;
  providerRef: string;
}
export interface PaymentProvider {
  id: PaymentMethodId;
  label: string;
  blurb: string;
  pay(amount: Money): Promise<PaymentResult>;
}
```

Mock (`mockPay`): resolves `{ ok: true, providerRef }` after a fixed 1400ms delay — **no failure path is modeled at all** (`ok` is always `true`); the real Stripe/Clearpay SDKs will need a failure branch the UI has never been exercised against.

---

## 7. Auth and session, as currently mocked

`AuthUser` (`types/auth.ts:14-21`): `{ id, name, email, kind: 'customer'|'staff', staffRole: StaffRole|null }`. **Customer and staff identity are the same type**, discriminated by `kind` + nullable `staffRole` — not separate types/tables in the current schema.

Session storage (mock only): `SESSION_KEY = 'fonology-mock-session'` in `window.localStorage` (`mock.adapter.ts:735-751`). `readMockSession`/`writeMockSession` just JSON-serialize the whole `AuthUser` into localStorage — no token, no expiry, no signature. `getSession()` reads it back synchronously (after artificial latency).

PIN lock (dashboard screen lock, **not authentication** — item 9 owns real auth): the PIN is `ShopSettings.adminPin` (`settings.ts:19`, regex `^\d{4}$`), default `'1234'` (`mock/admin.ts:237`). It is compared client-side wherever the lock overlay checks input (component not traced beyond `components/admin/pin-lock.tsx`, which calls `useSettings()`). The _locked_ boolean itself lives in a separate Zustand store, `useAdminStore` (`lib/stores/admin.store.ts:13-42`), persisted to `localStorage` under key `'fonology-admin'` — so the lock state survives a refresh but is trivially bypassable by clearing localStorage or editing it directly (mock-only concern, explicitly not real security per the file's own comment).

Guest flows (no user required) and how each record is keyed/looked up:

| Flow                                  | Requires session?                                                             | How keyed                                                                                                | How looked up later                                                                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest checkout (`/checkout`)          | No — `AuthUser`/session never referenced in `checkout-flow.tsx`'s create path | `Order.reference` = `"FNL-nnnn"` sequential (`nextReference()`, module counter, `mock/support.ts:11-15`) | `getOrderByReference(reference)` — exact string match, or via `getTracking(reference)`                                                                                                                |
| Guest repair booking (`/repair`)      | No                                                                            | `Booking.reference` — same `nextReference()` sequence, shared with orders                                | `getTracking(reference)`                                                                                                                                                                              |
| Guest sell request (`/sell`)          | No                                                                            | `SellRequest.reference` — same shared `nextReference()` sequence                                         | `getTracking(reference)`                                                                                                                                                                              |
| Order/repair/sell tracking (`/track`) | No                                                                            | N/A (read-only)                                                                                          | `getTracking(reference)` — reference **alone**, uppercased/trimmed, checked against bookings, then orders, then sell requests in that fixed order (`mock.adapter.ts:202-212`); no email/second factor |

All three guest-creatable entities (`Order`, `Booking`, `SellRequest`) draw their reference from the **same single counter** (`nextReference()`), which is why they're all `"FNL-nnnn"` and why a reference collision across kinds is structurally impossible in the mock — but see §13 for why this counter itself won't survive a real backend unchanged.

---

## 8. Business logic currently living in the frontend

**Delivery cost.** `DELIVERY_OPTIONS` (`lib/config.ts:33-43`): `collect`→£0, `standard`→£3.95, `next-day`→£6.95, `remote`→£9.95 (flat by method, postcode does **not** affect price — the "remote" tier is a manually-selected option, not postcode-derived). `createOrder` looks up the fee by `input.delivery` (`mock.adapter.ts:151`). **Contradicts `INTEGRATION.md:119`**, which still documents a flat £2.99 fee — see `QUESTION-TRIAGE.md` §16 for the full discrepancy.

**Promotion / bulk tier evaluation.** `promoUnitPrice(promo, quantity)` (`promotion.ts:47-52`): picks the highest `minQty` tier the quantity satisfies. `promotionFor(promotions, productId)` (`promotion.ts:55-60`): finds the first active promotion whose `productIds` includes the product. Evaluation is **per identical product**, not across the basket — buying 2 of product A that's covered hits the tier; 1 of A + 1 of B (both covered by the same promotion) does not, because `promoUnitPrice` is called per line with that line's own quantity (confirmed by the till usage described in `NOTES.md:225-233`).

**Discount + below-cost check.** POS order-level discount is a single pre-resolved pence amount by the time it reaches `SaleInput.discount` (`pos.ts:41` — "already resolved from % or £ entry"; the %/£ toggle itself lives in the POS UI component, not extracted here since it's presentational). Below-cost: `pos-view.tsx:93` — `belowCost = lines.length > 0 && total <= costTotal`; gated non-blocking by `POS_CONFIG.blockBelowCost` (`config.ts:29-31`, currently `false`). No reason is captured when a below-cost sale completes.

**Split payment validation.** Enforced twice: client-side in the Zod refinement on `saleInputSchema` (`pos.ts:44-52` — `paid === total`, exact match, no tolerance) and again defensively in `completeSale` (`mock.adapter.ts:578-582`, throws `'Payments don't add up to the total — check the split.'`). Both use exact integer-pence equality — no rounding tolerance anywhere.

**`getTodaySummary`.** `mock.adapter.ts:638-650`: filters `adminDb.transactions` to `amount > 0 && at >= today 00:00 local`, returns `{ date, total: Σamount, sales: count }`. Excludes negative rows (refunds, trade-in payouts) by construction — "today's revenue" here silently nets out nothing; a day with heavy refunds would still show gross positive sales only, not a true net figure. Uses the **local** clock of whatever machine runs the code (see §13, timezone note).

**Analytics** (`mock/analytics.ts:49-158`, full logic read):

- `revenue = Σ positive amounts` in range, `cost = Σ their cost`, `profit = revenue − cost`, `margin = profit/revenue` (0 if revenue is 0). Trade-in payouts (negative `amount`) are excluded from `sales`/`revenue` by the `t.amount > 0` filter, appearing only in the raw `transactions` list.
- Bucketing: `days = round((toExclusive − from) / 86400000)`; `bucket = days > 62 ? 'month' : 'day'`. Empty buckets are kept (zero-filled) so the time axis has no gaps.
- `busiest`: a `Map` keyed `"${day}-${hour}"`, `day` via `mondayIndex()` = `(date.getDay() + 6) % 7` → **0 = Monday**, `hour` = local `getHours()`. Only cells with ≥1 sale appear (sparse, not a full 7×24 grid).
- `byTender`: one entry per `TENDERS` constant (fixed order `cash, pos1, pos2, transfer, stripe`), even if zero.
- `prevRevenue`/`prevProfit`: same-length immediately-preceding window, for headline deltas.

**Return/refund eligibility.** `createRefund` (`mock.adapter.ts:378-459`): resolves `soldTotal`/`soldAt` by source (`order` → exact reference match on `mockDb.orders`; `counter` → sums all ledger rows sharing that reference where `amount > 0 && stream === 'shop'`, earliest `at` = sale time; `no-receipt` → no lookup, always treated as outside window). Rejects if `input.amount > soldTotal`. `withinWindow = source !== 'no-receipt' && ageDays <= windowDays` where `windowDays = adminDb.settings.returnWindowDays` (the **configurable** Settings value, not the hardcoded `RETURN_WINDOW_DAYS` constant — see §13). Throws a human-readable message if outside window and `!override`. On success: pushes a negative `Transaction` (`stream: 'shop'`), and if `restock`, increments `stockQty` for each line with a `productId`.

**Low-stock threshold.** Default `5` (`mock/admin.ts:235`), stored in `ShopSettings.lowStockThreshold`, read via `settings?.lowStockThreshold ?? 5` in every consuming component (`overview-view.tsx:33`, `inventory-view.tsx:37`) — the `?? 5` fallback is duplicated per call site rather than centralized. `isLowStock(qty, threshold) = qty > 0 && qty <= threshold` (`inventory.ts:78-80`) — global threshold, not per-product.

**Trade-in payout representation.** `createTradeInPayout` (`mock.adapter.ts:467-500`): if `sourceReference` given, must resolve against `mockDb.sellRequests` or throws. Pushes a **negative** `Transaction` with `stream: 'trade-in'`, `reference` from its own `BUY-nnnn` series (`nextBuyInReference()`, `mock/admin.ts:798-802`, separate counter starting at 2041). Despite `INTEGRATION.md:193-194` documenting that a linked `SellRequest` "should move to `paid`", **the mock does not do this** — confirmed by reading the full function body (no write to `mockDb.sellRequests`).

**Reference-number generation** — all three formats, all module-state counters (see §13 for why this is a problem for a real backend):

- Orders/Bookings/SellRequests: `nextReference()` (`mock/support.ts:11-15`) — shared counter starting at 1041, format `"FNL-nnnn"`.
- Jobs: `nextJobReference()` (`mock/admin.ts:791-795`) — separate counter starting at 5112, same `"FNL-nnnn"` format (**overlaps the same prefix as orders/bookings/sell** — a job reference and an order reference could theoretically collide in format even though the counters are separate in the mock; nothing in the schema distinguishes an `"FNL-1234"` job reference from an `"FNL-1234"` order reference except which table you look in).
- Trade-in payouts: `nextBuyInReference()` (`mock/admin.ts:798-802`) — separate counter starting at 2041, format `"BUY-nnnn"`, deliberately distinct so a payout is never mistaken for a sale (explicit design intent, `NOTES.md:201`).
- POS sale receipts reuse `nextReference()` too (`mock.adapter.ts:598`) — so till receipts, online orders, mail-in bookings, and sell requests **all share one counter and one `"FNL-"` prefix**, while jobs have their own counter with the same prefix format, and trade-ins alone get a visually distinct prefix.

---

## 9. Repair and sell catalog structure

**Devices** (`mock/repairs.ts:9-22`) — flat list, `{id, name, brand, priceMultiplier}`, e.g.:

```ts
{ id: 'ip14', name: 'iPhone 14', brand: 'apple', priceMultiplier: 1.15 }
{ id: 'other', name: 'Something else', brand: 'other', priceMultiplier: 1.0 }
```

11 real devices (6 Apple, 3 Samsung, 2 Pixel) + one `other` catch-all with `priceMultiplier: 1.0`.

**Repair types** (`mock/repairs.ts:24-67`) — `{id, name, desc, time, base: {original,oem,copy}|null}`, 6 entries: `screen`, `battery`, `port` (all priced), `water-damage`, `data-recovery`, `other` (all three `base: null`, "diagnosis-only").

**Part tiers** (`mock/repairs.ts:69-91`) — 3 fixed entries `original`/`oem`/`copy`, each with `{name, strap, line, warranty}` marketing copy; warranty strings are `"12-month warranty"` / `"6-month warranty"` / `"90-day warranty"` respectively — **free text, not a structured duration field**.

**Pricing formula** (identical in `mock.adapter.ts:48-58 computeQuote` and `lib/data/repair-pricing.ts:11-19 computeRepairPrice` — genuinely duplicated logic, kept in sync by hand): `price = round(basePence/100 × device.priceMultiplier) × 100`, i.e. rounds to whole pounds before converting back to pence — matches the original prototype's display maths exactly. `null` in, `null` out (diagnosis-only repairs never get a price).

**Sell/trade-in form fields** (`sellRequestInputSchema`, `sell.ts:34-44`): `deviceId` (ref into the same `MOCK_DEVICES` list as repair — shared catalog), `deviceOther?` (free text, used when `deviceId === 'other'`), `condition: SellCondition` (`storage` free text, `screen` enum, `body` enum, `powersOn` bool, `network` enum, `accessories: string[]` free text array), `name`, `phone`, `email`, `preferredContact`, `notes?`.

**Sell request states**: `received → quoted → accepted → paid → declined` (`sell.ts:47`). **No quote-acceptance step exists in the contract** — there is no adapter method to move a request between any of these states (see §3); the enum describes an intended flow the mock never drives past `received`.

---

## 10. File uploads

Every upload in the UI is a **filename-only mock** — none of the three below touch real storage; the schemas already carry the eventual references as plain strings:

| Location                                                                            | Attaches to                                     | Accepted types                                                                                                                                                                                                                                                                 | Multiple?                                                      | Metadata captured                                                                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Number-plate verification (`checkout-flow.tsx`, plate products only)                | `Order.verification.{registrationDoc, licence}` | UI copy says "PDF or image" (`product-detail.tsx`); **no `accept` constraint enforced in the schema** — `orderVerificationSchema` just requires two non-empty strings                                                                                                          | No — exactly one file per field (`registrationDoc`, `licence`) | Filename only (`e.target.files?.[0]?.name`, `checkout-flow.tsx:333`); no size, MIME, or upload timestamp |
| Local buy-in form (`inventory-view.tsx` / product dialog, when `localBuying: true`) | `AdminProduct.buyInForm`                        | Not constrained in schema                                                                                                                                                                                                                                                      | No — single string field                                       | Filename only                                                                                            |
| Product photos                                                                      | `Product.images: string[]`                      | Schema requires each entry to be a valid URL (`z.string().url()`) once real, but `ProductInput.images` (the create/edit form payload) is just `z.array(z.string())` with **no URL constraint** — the stricter constraint only applies to the read model, not the write payload | Yes — array                                                    | Filename/ref only, no size/MIME/dimensions                                                               |

Mock behaviour for all three: the UI stores whatever string the file input reports (the browser-native filename) and treats it as "uploaded". `INTEGRATION.md:202-204`: "Uploads are UI mocks (filenames only)... When storage exists, these become real upload refs — the schemas already carry them as strings." No progress/error state is modeled for any of the three (no upload-failed path in the UI code inspected).

---

## 11. List views — query parameters

| List                                                                                                                               | Filter/sort/search params the UI sends                                                                                                                                                                                                                                | Pagination                                                                                                                                                   | Response shape expected                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Products (`listProducts`)                                                                                                          | `ProductQuery { category?, search?, sort?: 'featured'\|'price-asc'\|'price-desc' }` — the **only** list method in the entire contract that accepts any query object                                                                                                   | None                                                                                                                                                         | Bare `Product[]`                                                                                                                                                     |
| Admin products, Jobs, Promotions, Staff, Label templates, Cash entries, Refunds, Trade-in payouts, Orders, Bookings, Sell requests | **None** — every one of `listAdminProducts()`, `listJobs()`, `listPromotions()`, `listStaff()`, `listLabelTemplates()`, `listCashEntries()`, `listRefunds()`, `listTradeInPayouts()`, `listOrders()`, `listBookings()`, `listSellRequests()` takes **zero arguments** | **None** — every one returns the full array, unpaginated (`Paginated<T>` exists in `common.ts:34-40` and is never used anywhere in the actual `DataAdapter`) | Bare `T[]` in every case; all client-side filter/sort/search (where it exists at all, e.g. `DataTable`'s built-in search) happens **after** the full list is fetched |
| Transactions (`listTransactions`)                                                                                                  | `AnalyticsQuery { from, to }` (both required, inclusive day range)                                                                                                                                                                                                    | None                                                                                                                                                         | Bare `Transaction[]`, pre-sorted newest-first by the mock                                                                                                            |
| Analytics (`getAnalytics`)                                                                                                         | `AnalyticsQuery { from, to }`                                                                                                                                                                                                                                         | N/A (aggregate)                                                                                                                                              | `AnalyticsSummary`                                                                                                                                                   |

This is the single biggest "won't survive contact with a real database" fact in the whole contract — see §13.

---

## 12. Known gaps already recorded

`NOTES.md` and `CONTENT-TODO.md` are reproduced in full in the "Reading the docs" step of `QUESTION-TRIAGE.md`'s method section and are not re-pasted here to avoid duplicating ~500 lines; every fact from both files that bears on a specific backend question is already quoted with file:line in `QUESTION-TRIAGE.md`. Summary of what each contains: `NOTES.md` — phase map, per-phase decisions/flags (mail-in repair redesign, sell grading fields, checkout design, admin design language, jobs/inventory/promotions rules, returns window, PIN lock, analytics definitions), the 8 open questions, the verified standalone-build notes, storefront discrepancies (deliberately reproduced, not bugs), Lighthouse scores, the money-out/promotions/returns changelog, the auth-surface redesign log, six "gotchas" for anyone testing the app, and the money/VAT/font/Tailwind decisions. `CONTENT-TODO.md` — homepage stats, contact details, grade example prices, promo copy, social links, the 8 legal/content pages awaiting client copy, and the POS receipt template status.

**TODO/FIXME/HACK/XXX/`@ts-expect-error`/`as any`/`eslint-disable` grep** (full repo, `apps/web/src`): no `TODO`, `FIXME`, `HACK`, `XXX`, or `@ts-expect-error` markers exist anywhere in the source. `as any` (as a standalone type assertion): zero matches. `eslint-disable` — 5 occurrences, all narrow and justified, not markers of unfinished work:

- `app/error.tsx:16` and `components/shared/error-boundary.tsx:31` — `no-console`, both wrapping an intentional `console.error` in an error boundary.
- `components/storefront/home/why-stats.tsx:71`, `components/storefront/repair/repair-flow.tsx:88`, `components/admin/staff/staff-view.tsx:126` — all `react-hooks/exhaustive-deps`, suppressing a dependency-array warning (each is a single-line suppression next to a `useEffect`, not investigated further here since it's a lint suppression, not a functional gap).
- `components/admin/data-table.tsx:47` — `@typescript-eslint/no-explicit-any`, one generic-table internal.

**Placeholder fixtures.** Contact details (`lib/site.ts`) are explicitly placeholder per `CONTENT-TODO.md` (phone `01234 567 890`, address "Unit 4, The Parade, High Street, Yourtown, YT1 2AB" — a fictitious town). Social links are literal `#` hrefs. Eight legal/info routes render a "Content to be finalised" block (`components/storefront/content-placeholder.tsx`) instead of real copy. The POS receipt template (`components/pos/receipt.tsx:11`) is explicitly commented "PLACEHOLDER TEMPLATE pending the client's format." No `£0.00`, "Test", or lorem-ipsum values were found in the seeded mock data itself (`mock/admin.ts`, `mock/products.ts`, `mock/repairs.ts`) — the seed data is deliberately realistic (named staff, real-shaped transactions, a full year of generated history), which is a design choice (`mock/admin.ts:17-22`: "a believable business") rather than an oversight, but it does mean **the seed data looks production-like enough that someone could mistake it for real** if it ever shipped un-swapped — worth a release-checklist line.

---

## 13. Own findings

**Inconsistent modelling of the same concept, twice.**

1. **Return window.** `lib/config.ts:11` hardcodes `RETURN_WINDOW_DAYS = 30` and every storefront-facing surface reads that constant directly (receipt, auth panel, PDP, returns-policy page — six call sites, see `QUESTION-TRIAGE.md` list 3 item 4). Meanwhile `ShopSettings.returnWindowDays` (default also 30) is the value `createRefund` actually enforces, and it's editable in Settings. Change the setting and every piece of customer-facing copy about the return window goes stale relative to the number the till actually enforces. These need to become the same field before backend work starts, not two fields that happen to agree today.
2. **Delivery fee.** As covered in `QUESTION-TRIAGE.md` §16 — `INTEGRATION.md` documents a flat £2.99 (`pricing.ts:43`'s unused `DELIVERY_FEE` constant) while the actual checkout uses tiered `DELIVERY_OPTIONS` (£3.95/£6.95/£9.95). Same shape of bug as #1: two sources of truth for one number, one of them dead code that a doc still points to.
3. **Sale line items vs. `Transaction` rows.** A POS sale with a split payment is recorded as **one `Transaction` row per payment portion** (`completeSale`, `mock.adapter.ts:604-622`), each carrying the _whole_ sale's `reference` and a pro-rata slice of `cost`, but **none of them carry the individual `SaleLine`s**. `createRefund`'s `counter` path (`mock.adapter.ts:394-405`) has to reverse-engineer "what was sold" by summing ledger rows sharing a reference — it cannot know _which products_ were on that receipt, only the total. `INTEGRATION.md:224-229` already flags this ("mock resolves them by summing... because it does not persist `Sale` records... your backend should persist sales with line detail") — worth restating here because it's the reason counter returns require staff to re-enter items by hand instead of prefilling like online-order returns do.

**Adapter methods that won't survive contact with a real database.**

- **Every unpaginated `listX()` method** (§11) — 11 of them return the entire table with zero filter/sort/page arguments. `listJobs()`, `listStaff()`, `listPromotions()`, etc. work fine against ~10-100 seeded rows; against a real shop's order/transaction history they will not. `Paginated<T>` already exists in `common.ts:34-40` unused — the shape is there, nothing calls for it yet.
- **`getTracking(reference)`** does a linear fan-out scan across three separate collections in a fixed order (bookings, then orders, then sell requests) with no index/uniqueness guarantee across them — fine for three small in-memory arrays, needs either a shared reference-number table or three indexed lookups server-side.
- **`adjustStock(id, delta)`** takes a bare signed integer with no idempotency key, no reason, and "never below 0" clamping done client-side in the mock (`Math.max(0, ...)`) — a real implementation needs an atomic, race-safe decrement (two concurrent requests each reading `stockQty` before either writes will double-count in a naive port), and the clamping-without-erroring-when-clamped behaviour (silently flooring instead of rejecting) should be a deliberate server-side choice, not inherited by accident.
- **`updateJob(id, patch)`** is called optimistically by the board (drag-through), so the backend's response contract (return the full updated `Job`, UI rolls back on error) has to be preserved exactly, including on partial-failure — nothing in the current type signature distinguishes "job not found" from "patch rejected by a business rule," both just `throw new Error(...)` with a string message the UI displays verbatim.

**Hidden hard backend problems.**

- **Reference-number generation is non-atomic module state.** `nextReference()`/`nextJobReference()`/`nextBuyInReference()` (§8) are plain in-memory counters — "the mock DB is module state — a full page load resets it" (`NOTES.md:303-306`, the project's own words). A real backend needs a proper atomic sequence (DB sequence, or a `SELECT ... FOR UPDATE`-guarded counter table) to avoid duplicate references under concurrent checkouts; nothing in this codebase demonstrates what that should look like.
- **Concurrency on stock.** Both `completeSale` and `adjustStock` mutate `stockQty` with a plain read-modify-write — safe only because JS is single-threaded and the mock has one client. `INTEGRATION.md:220` already tells Raja to "deduct stock atomically," but doesn't say how; two simultaneous POS terminals selling the last unit of the same product is the concrete failure case to design against.
- **Money rounding in split payments.** `completeSale`'s pro-rata cost allocation (`mock.adapter.ts:604-622`) computes `costShare = round(cost × payment.amount / total)` for every payment except the last, which absorbs the remainder (`costRemaining`) — this avoids a rounding leak _for cost_, but the same pattern is not applied anywhere for allocating **discount** across lines when a promotion/discount touches a multi-line sale; worth checking whether any UI path needs per-line discount allocation before assuming the current total-only discount is sufficient.
- **Time zones.** `getTodaySummary` (`00:00 local`), `mock/analytics.ts` bucketing (`parseIsoDay` builds a **local** `Date` from `"YYYY-MM-DD"`, `mondayIndex`/hour bucketing use local `getHours()`/`getDay()`), and the cash view's `isoDay()` (`lib/dates.ts`, used for "today") all rely on **whatever timezone the runtime executes in** — the browser's zone in the mock today, but the **server's** zone once this logic moves server-side per `INTEGRATION.md`. If the server ever runs in UTC (common for containers) while the shop is in `Europe/London`, "today" and hour-bucketed footfall will be off by up to an hour (and by a full day right at midnight during BST). Nothing in the codebase pins a timezone explicitly anywhere — this needs an explicit decision (store everything UTC, convert to `Europe/London` only at the aggregation boundary), not a silent inheritance of whatever `TZ` the container happens to have.
- **Uniqueness across the shared `"FNL-"` prefix.** As noted in §8, orders, bookings, sell requests, and POS sale receipts all draw from one counter and jobs draw from a separate counter using the _same_ display format — a real schema needs to decide whether reference numbers are globally unique across all these entity types (one sequence) or only unique within type (current mock behaviour, accidentally) before `getTracking`'s cross-table lookup can be trusted at scale.
