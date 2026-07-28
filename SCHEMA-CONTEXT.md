# Schema context — current HEAD

Extraction only, checked against the actual code at current `HEAD`, not
copied from `BACKEND-INPUTS.md`/`QUESTION-TRIAGE.md` (both predate the last
two commits and are treated as unreliable below). Nothing was modified to
produce this file. `NOT DETERMINABLE` is used wherever the code doesn't say.

---

# PART A — What changed

Diffed `15d2315` (the commit `BACKEND-INPUTS.md` was written against) against
current `HEAD` (`9e955c0`). Two commits: `73c0992` (deploy trigger, no code)
and `9e955c0` ("Admin online-orders panel, per-product low-stock, POS my-day +
card splits"). 27 files changed. Below is what actually changed — everything
in `BACKEND-INPUTS.md` not mentioned here is unaffected by this diff and can
still be trusted as-is.

### `inventory.ts` — low-stock moved onto the product [commit `9e955c0`]

`StockMeta` and `ProductInput` both gained two fields: `lowStockAlert: z.boolean()` and `lowStockThreshold: z.number().int().min(1)`. `isLowStock(qty, threshold)` still exists as a primitive; a new `productIsLowStock(product)` (`= product.lowStockAlert && isLowStock(product.stockQty, product.lowStockThreshold)`) is now "the one to use everywhere" per its own doc comment, and every call site was migrated to it (`pos-view.tsx`, `inventory-view.tsx`, `overview-view.tsx`).

### `settings.ts` / `ShopSettings` — `lowStockThreshold` removed entirely [commit `9e955c0`]

`shopSettingsSchema` no longer has `lowStockThreshold`. `ShopSettings` is now 4 fields, not 5 (full current list in Part B §28). `settings-view.tsx` dropped the input field and replaced it with static copy pointing to the product form.

### `pos.ts` — three new schemas, nothing removed [commit `9e955c0`]

Added `todaySaleSchema` (`TodaySale`), `todayTenderSchema` (`TodayTender`), and `todayReportSchema` (`TodayReport`) — full shapes in Part B §17/§31. `SaleInput`/`Sale`/`SalePayment` are **unchanged** — the "card splits" feature (below) is a POS-component-local UI state machine, not a schema change.

### `order.ts` — order status became a state machine [commit `9e955c0`]

Added `orderStatusLabel(status)` and:

```ts
export const ORDER_STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['ready', 'shipped', 'cancelled'],
  ready: ['collected', 'shipped', 'cancelled'],
  shipped: [],
  collected: [],
  cancelled: [],
};
export function nextOrderStatuses(status: OrderStatus, delivery?: DeliveryMethod): OrderStatus[] {
  // filters 'shipped' out for collect orders, 'collected' out for delivery orders
}
```

This is the first time `OrderStatus` had any enforced transition logic — previously (per `BACKEND-INPUTS.md` §3) the mock never moved an order past `'paid'` at all. Now it can, via a new adapter method (next).

### `mock.adapter.ts` / `types.ts` / `http.adapter.ts` — new methods [commit `9e955c0`]

Two new `DataAdapter` methods:

- **`updateOrderStatus(id: Id, status: OrderStatus): Promise<Order>`** — throws `'Order not found...'` if the id doesn't resolve, throws a "Can't move an order from X to Y" message if `status` isn't in `nextOrderStatuses(order.status)` (delivery method isn't checked in the mock's guard — only the plain `ORDER_STATUS_FLOW`, so the mock is slightly more permissive server-side than the UI's own button set, which does pass `delivery`). Mutates and returns the order. `http.adapter.ts` stub added, throws `notImplemented`.
- **`getTodayReport(): Promise<TodayReport>`** — fully derived (see Part B §17 for the exact grouping logic).

`getTodaySummary` itself changed behaviour, not just signature: `sales` used to be `rows.length` (one row per payment portion); it is now `new Set(rows.map(t => t.reference)).size` — **distinct sales**, matching a split-payment sale counting once. This is a **breaking change in meaning** for anyone who read the old `TodaySummary.sales` as "number of payment rows" — it now means "number of distinct receipts," same definition `getTodayReport.salesCount` uses.

### `permissions.config.ts` — still role-based, one new tab, no new permission [commit `9e955c0`]

Only `POS_TABS` changed — one line added:

```ts
{ label: 'My day', href: '/pos/day', permission: 'sales.today' },
```

The `Permission` union, `EMPLOYEE_PERMISSIONS`, `MANAGEMENT_PERMISSIONS`, `ROLE_PERMISSIONS`, and `can()` are byte-for-byte unchanged. See the direct answer in Q1 below.

### `mock/support.ts` — 4 more seeded orders, no generator logic change [commit `9e955c0`]

Purely data: `ord-1003`..`ord-1006` added to `mockDb.orders` (one each in `paid`, `pending`, `collected`, and one more `paid`), giving the new Orders panel something to filter. `nextReference()` and the rest of the file are untouched — reference generation did **not** change (see Q3).

### `mock/admin.ts` — stock meta gets the two new fields, settings default drops one [commit `9e955c0`]

Every entry in `MOCK_STOCK_META` gained `lowStockAlert`/`lowStockThreshold`. Notably: `pulse-anc` got a wider threshold (10, "moves fast"), `halo-stand` (4) and `privacy-14` (6) sit deliberately at/below their own thresholds, and both vape products plus both plate products got `lowStockAlert: false` — **vapes and plates are now deliberately excluded from low-stock alerting in the seed data**, a new fact not present before. `DEFAULT_SETTINGS.lowStockThreshold` was deleted (consistent with `settings.ts`).

### New route: `/admin/orders` [commit `9e955c0`]

`app/(dashboard)/admin/orders/page.tsx` renders `OrdersView` with **no `RouteGuard`, no `<Can>`** — same ungated pattern as every other `/admin/*` route (`BACKEND-INPUTS.md` §4's finding still holds, and now covers one more screen). Added to `admin-shell.tsx`'s nav under "Operations", first item.

### New route: `/pos/day` [commit `9e955c0`]

`app/(pos)/pos/day/page.tsx` — wrapped in `RouteGuard permission="sales.today"`, consistent with every other `/pos/*` route.

### `NOTES.md` / `INTEGRATION.md` — both updated in step with the code [commit `9e955c0`]

No contradictions introduced this time — both docs describe the four changes above accurately, including the "keep `getTodayReport` and `getTodaySummary` in agreement" instruction to the backend (`INTEGRATION.md`).

---

## Direct answers

**1. Is `permissions.config.ts` still role-based, or per-person?**
Still role-based. Nothing changed except one new tab entry reusing an existing permission. Full current contents:

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

const EMPLOYEE_PERMISSIONS: Permission[] = [
  'pos.operate',
  'jobs.manage',
  'inventory.manage',
  'promotions.manage',
  'cash.manage',
  'tradein.manage',
  'sales.today',
];

const MANAGEMENT_PERMISSIONS: Permission[] = [
  ...EMPLOYEE_PERMISSIONS,
  'costs.view',
  'analytics.view',
  'payments.view',
  'reports.view',
  'returns.manage',
  'labels.manage',
  'staff.manage',
  'settings.manage',
];

export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  owner: MANAGEMENT_PERMISSIONS,
  manager: MANAGEMENT_PERMISSIONS,
  technician: EMPLOYEE_PERMISSIONS,
  counter: EMPLOYEE_PERMISSIONS,
};

export const POS_TABS: PosTab[] = [
  { label: 'Checkout', href: '/pos', permission: 'pos.operate' },
  { label: 'Jobs', href: '/pos/jobs', permission: 'jobs.manage' },
  { label: 'Inventory', href: '/pos/inventory', permission: 'inventory.manage' },
  { label: 'Promotions', href: '/pos/promotions', permission: 'promotions.manage' },
  { label: 'Cash', href: '/pos/cash', permission: 'cash.manage' },
  { label: 'Trade-ins', href: '/pos/trade-ins', permission: 'tradein.manage' },
  { label: 'My day', href: '/pos/day', permission: 'sales.today' },
];
```

Nothing keys off an individual staff id anywhere in this file — permission is a pure function of `StaffRole` (one of 4 values), and `technician`/`counter` still resolve to the identical permission set.

**2. Is the low-stock threshold global, per-product, optional per-product, or a combination?**
**Per-product, with per-product opt-out** — the global setting was deleted, not just deprecated. Current fields, both on `StockMeta` (and mirrored on `ProductInput`):

```ts
lowStockAlert: z.boolean(); // on/off switch, per product
lowStockThreshold: z.number().int().min(1); // the count to warn at, per product — ignored when lowStockAlert is false
```

`ShopSettings` has no low-stock field of any kind anymore. Every product always carries a `lowStockThreshold` number (even when its alert is off — the field isn't nulled, just ignored), so there's no "unset" state; it's boolean-gated, not nullable-gated.

**3. Did `mock/support.ts` change reference-number generation? Can two series still collide?**
**No, reference generation itself is untouched.** `mock/support.ts` only gained 4 more seed `Order` rows (`ord-1003`–`ord-1006`, references `FNL-1003`–`FNL-1006`); the `nextReference()` function (module counter, starts at 1041, format `"FNL-nnnn"`) is byte-identical to before. So every fact in `BACKEND-INPUTS.md` §8/§13 about reference generation still holds exactly:

- Orders, bookings, sell requests, and POS sale receipts share one counter (`nextReference()`), all `"FNL-nnnn"`.
- Jobs have a separate counter (`nextJobReference()`, starts at 5112) but the **same display format** `"FNL-nnnn"` — a job reference and an order reference remain visually indistinguishable and could collide in string form even though the two counters won't produce the same number in practice today (job counter starts at 5112+, order/booking/sell/sale counter starts at 1041+ and would need ~4000 uses to overlap that range — collision is currently avoided by starting offset, not by design).
- Trade-in payouts alone get a genuinely distinct prefix (`"BUY-nnnn"`, `nextBuyInReference()`, starts at 2041).
- All three counters are still plain in-memory module state, reset on reload — this remains a hard problem for the real backend (see Part C §1).

## What the new admin orders panel, POS my-day view, and card splits each read/write

**Admin online-orders panel** (`/admin/orders`, `components/admin/orders/orders-view.tsx`):

- **Reads:** `useOrders()` → `listOrders()` → `Order[]` (the same full, unfiltered list every other order-consuming screen gets — no new query params).
- **Writes:** `useUpdateOrderStatus()` → `updateOrderStatus(id: Id, status: OrderStatus)` → updated `Order`. Applied optimistically (patches the cached `Order[]` array client-side, rolls back via a toast on error, then invalidates `queryKeys.orders.all` regardless of outcome).
- **Data shapes involved:** `Order`, `OrderStatus`, `OrderStatus[]` (via `nextOrderStatuses`), `DeliveryMethod` (read-only, used to decide which status buttons to show — `collect` orders never get a "shipped" button, others never get "collected"). No new entity — this panel is a view + one mutation over the existing `Order` table.

**POS "My day"** (`/pos/day`, `components/pos/day-view.tsx`):

- **Reads only:** `useTodayReport()` → `getTodayReport()` → `TodayReport`, refetched every 60s (`refetchInterval: 60 * 1000`). No mutation anywhere in this component.
- **Data shapes involved:** `TodayReport { date, total, salesCount, averageSale, lastSaleAt, byTender: TodayTender[], sales: TodaySale[] }`. `TodaySale` and `TodayTender` are both derived-only — built by grouping `adminDb.transactions` rows by `reference` inside `getTodayReport`, not persisted anywhere themselves.
- One data quirk worth carrying into the schema design: `getTodayReport` remaps `tender === 'stripe'` to `'transfer'` before grouping (`row.tender === 'stripe' ? 'transfer' : row.tender`), so Stripe-paid online orders that happen to settle "today" would show up folded into the Transfer bucket on this counter-facing view — deliberate (Stripe isn't a POS tender), but worth knowing the raw `tender` value is being reinterpreted, not passed through.

**Card splits** (`components/pos/pos-view.tsx`): **UI-only, no data-shape change.** `PaymentPortion` (a component-local, never-persisted interface) gained a `pending` status between "not yet sent" and `waiting`/`approved`, so a card amount can be typed and edited before `paymentTerminal.charge()` is actually called, allowing one bill to be split across POS 1 and POS 2 (or two attempts on one terminal after a decline). Nothing new is read or written from the adapter for this — the final `payments: SalePayment[]` array handed to `completeSale` is built from the same `SalePayment { tender, amount }` shape as before; the schema in Part B §17 is unaffected.

---

# PART B — Not covered before

## Products and catalog

**1. Variants.** None. `productSchema` (`product.ts`) has exactly one `price`, one `stockStatus`, one set of `images`/`specs`/`highlights` per product row — there is no colour/capacity/size/model-fit field, no parent-product/variant-product relationship, and `AdminProduct` (= `Product ⊕ StockMeta`) likewise has one `stockQty`/`costPrice`/`barcode` per row. Anything sold in more than one flavour today would need to be a **separate product row per flavour** (that's how the catalogue is modelled now — e.g. presumably separate rows would exist per phone-compatibility SKU rather than one product with a compatibility picker). This is a from-scratch design decision for the backend, not something to port forward.

**2. Categories.** Flat, not nested. `categorySchema = { id: 'all' | productCategoryIdSchema, label: string }` — `productCategoryIdSchema` is a fixed 7-value enum (`cases, power, audio, protection, mounts, vape, plates`), not a table, so there's no parent/child relationship possible in the current model at all. A product has exactly **one** `category` field (`ProductCategoryId`, singular) — a product cannot belong to more than one category today. No ordering field exists on `Category`; `MOCK_CATEGORIES` (array order in `mock/products.ts`) is presumably display order by convention, not an explicit `sortOrder` field — **NOT DETERMINABLE** whether that array order is meant to be authoritative or incidental.

**3. Product images.** `images: z.array(z.string().url())` on the read model, `images: z.array(z.string())` (no URL constraint) on `ProductInput`. Just an ordered array of strings — the array's own order is implicitly the display order (nothing marks one image as "main"; convention is presumably "first item is the hero image," but that's not encoded anywhere, so **NOT DETERMINABLE** as a formal rule). No alt text, no per-image metadata (dimensions, size, uploaded-by, uploaded-at) — the schema is `string[]`, full stop.

**4. Barcodes.** One per product: `barcode: z.string().nullable()` on `StockMeta` — a single optional string field, not an array, so the schema as written cannot represent a product with multiple barcodes (e.g. old and new packaging). Nothing in the schema or mock prevents two different products from being saved with the same barcode string — there's no uniqueness constraint anywhere client-side (see Part C §1). The comment on the field (`inventory.ts`: "EAN/UPC/code as scanned — USB HID scanners type into this field") implies it's meant to be the **manufacturer's** barcode (EAN/UPC), not a shop-generated SKU — but plate products in the seed data have `barcode: null`, and the shop's own printed shelf labels (Label designer, `components/admin/labels`) use a **separate**, freely-typed `barcode: z.string().nullable()` field on `LabelTemplate` (`label.ts`) that has no link back to `StockMeta.barcode` at all — two independent barcode-shaped strings, unconnected in the schema (see Part C §7).

**5. "Free delivery" flag.** Does not exist on `Product`/`ProductInput` today — needs adding if the client wants per-product free delivery. The only free-delivery concept in the current code is the `collect` **method** in `DELIVERY_OPTIONS` (`lib/config.ts`, price `£0`), which is a delivery-method choice, not a product attribute, and applies shop-wide to every product identically.

**6. Vaping products — how the online-purchase block is enforced.** By `ProductKind`, not a separate flag: `productKindSchema = z.enum(['accessory', 'vape', 'plate'])`. Enforcement is two pure functions in `product.ts`:

```ts
export const isPurchasable = (p: Pick<Product, 'kind'>): boolean => p.kind !== 'vape';
export const canAddToCart = (p: Pick<Product, 'kind' | 'stockStatus'>): boolean =>
  isPurchasable(p) && p.stockStatus === 'in-stock';
```

Both are client-side only — there is no server enforcement anywhere (there is no server yet), so a real backend must re-check `kind !== 'vape'` on `createOrder` itself, not trust the client to have hidden the button. Category (`vape`) and kind (`vape`) happen to correlate 1:1 in the seed data but are **separate fields that could in principle disagree** — the block is coded against `kind`, not `category`.

## Stock

**7. How stock is counted.** One number per product: `StockMeta.stockQty: z.number().int().min(0)`. **Not** a ledger of movements — there is no stock-movement table, no list of individual stock-in/stock-out events that sum to a total. Every mutation (`completeSale`, `adjustStock`, `createRefund` with `restock: true`) does a direct read-modify-write on that single field (`product.stockQty = Math.max(0, product.stockQty ± n)`). This means the current model has **no audit trail of how a product arrived at its current count** — worth deciding explicitly whether the real schema should be event-sourced (a movements table, count = sum) or keep the single running-total column with a separate audit log bolted on.

**8. Supplier.** Just typed text, not a record: `StockMeta.supplier: z.string().nullable()` — a free string on the product itself, no `Supplier` entity, no supplier id, no supplier contact/address/terms anywhere in the schema. The seed data (`mock/admin.ts`) uses a handful of repeated supplier names ("Northline Trade Ltd", "Volta Distribution", "ShieldWorks UK", "iParts Direct", "PlateForm UK", "CloudTrade Vapes") purely as flavour text — nothing in the code treats them as a shared, deduplicated entity (two products with the same supplier string are not linked by any id, just by string equality, which the code never even checks).

**9. Cost price.** One value per product, no averaging: `StockMeta.costPrice: moneySchema` — a single current cost on the product row. When a sale happens, `SaleLine.costPrice` snapshots **whatever that single value is at the moment of sale** (`pos.ts` comment: "Unit cost at time of sale"). There is no per-delivery/per-batch cost record and no FIFO/weighted-average logic anywhere in the codebase — if a product is restocked at a different cost, the old `costPrice` is simply overwritten by whatever `updateProduct`/`ProductInput.costPrice` is submitted next, and every future sale (and every past `SaleLine`, since those are frozen snapshots) reflects whichever cost was in force at that instant. This is the same finding as the earlier extraction's §4/Q4, unaffected by the recent diff — restated here because it's structurally important for schema design: **a cost-history/batch table does not exist and would be new design, not a port.**

**10. Do repair jobs deduct stock? Is anything linked?** No, and no. `jobInputSchema`/`jobSchema` (`job.ts`, unchanged by the recent diff) has no parts list, no productId array, no reference of any kind into the product catalogue. `updateJob` (`mock.adapter.ts`) only does `Object.assign(job, patch, {updatedAt})` — it never touches `adminDb.products`. The only code path that decrements `stockQty` is `completeSale`, which only runs for POS/shop-catalogue lines. **The client's confirmation that repair parts share stock with counter sales is new information this session — nothing in the current code reflects it yet.** This is a from-scratch link to design: at minimum, a job needs a way to reference the product(s)/quantities consumed, and `completeSale`-style stock deduction needs to run on whatever event marks a job's parts as used (job creation? status → `in-progress`? status → `done`?) — the code gives no precedent for which point in the job lifecycle that should be, because the concept doesn't exist yet.

**11. Stock write-off / adjustment.** Exists, but bare: `adjustStock(id: Id, delta: number): Promise<AdminProduct>` — takes a signed integer, clamps the result at 0 (`Math.max(0, product.stockQty + delta)`), and returns the updated product. **No reason field, no category (damage/loss/internal-use/stocktake-correction), no note, no audit trail of who did it or when** — same finding as the earlier extraction, unaffected by the recent diff. It is literally the only mutation on `stockQty` that isn't tied to a sale or a restock, and it currently records nothing about _why_.

## Orders and customers

**12. Delivery address shape.** Two loose optional strings **on the order itself**, not a structured address and not a separate customer/address entity:

```ts
address: z.string().optional(); // OrderInput — free text, one line
postcode: z.string().optional(); // ukPostcodeSchema-validated when present
```

On the persisted `Order`: `address: z.string().nullable()`, `postcode: z.string().nullable()`. No line1/line2/city/county fields — it's a single free-text `address` string plus a separately-validated `postcode`. There is **no `Customer` entity at all** — nothing stores a delivery address independent of a specific order, and there is no concept of a customer saving more than one address, because there is no concept of a returning customer record in the first place (see Q15).

**13. Price at time of sale, or live product price?** Snapshotted at time of sale, not read live. `CartLine.unitPrice` (`order.ts`) — comment: "Unit price in pence **at time of adding**." The cart (Zustand client state) captures the price when a product is added, and that's what flows into `OrderInput.lines` → `Order.lines` unchanged. If the product's price changes between add-to-cart and checkout, the order still reflects the price at add-to-cart time (there's no re-validation against the live `Product.price` anywhere in `createOrder`) — worth deciding whether the real backend should re-check against current price at order-creation time (a common anti-fraud/consistency measure) since the frontend contract doesn't do it.

**14. Order line: snapshot or reference?** Snapshot, heavily. `CartLine` embeds `productId` (a reference) **plus** `name`, `sub`, `slug`, `kind`, and `unitPrice` — all copied at add-to-cart time, not looked up live. So an `Order.lines[]` entry is self-describing even if the product is later renamed, re-categorised, re-priced, or deleted; it is **not** a thin `{productId, quantity}` join row. Same pattern on `Sale.lines` (`SaleLine` snapshots `name`, `sub`, `unitPrice`, `listPrice`, `costPrice`) and on `Refund.lines` (`ReturnLine` snapshots `name`, `unitPrice`, with `productId` nullable for non-catalogue returns).

**15. Customer accounts.** `AuthUser` (`auth.ts`, unchanged by the recent diff) is the only "customer" shape in the entire codebase: `{ id, name, email, kind: 'customer'|'staff', staffRole: StaffRole|null }`. That's it — no phone, no saved address, no order history link, no marketing-preferences field, nothing beyond name/email/kind. **Google sign-in produces the exact same `AuthUser` shape as email/password** — `signInWithGoogle()` in the mock just fabricates `{ id: 'usr-google-demo', name: 'Demo Customer', email: 'demo.customer@gmail.com', kind: 'customer', staffRole: null }`; there is no separate field recording _which_ auth method was used (no `provider: 'google'|'password'`), so as modelled today, once a session exists, the app cannot tell how the person signed in. A real backend adding real OAuth will need to add that distinction — nothing in this schema anticipates it.

**16. Guest orders — keying and lookup.** Unchanged from the earlier extraction (`order.ts`, `mock.adapter.ts` not touched here except the new `updateOrderStatus` method): a guest order is keyed purely by `Order.reference` (`"FNL-nnnn"`, from the shared `nextReference()` counter — no customer id, no session, no email-as-key). `/track` finds it via `getTracking(reference)`, matching the trimmed/uppercased reference string alone against bookings, then orders, then sell requests, in that fixed order — no email or secondary check anywhere in the lookup.

## Till, money, cash

**17. Split payments — current shape.** `SaleInput`/`Sale` (`pos.ts`, schema unchanged by the recent diff, only the surrounding UI state machine changed — see Part A):

```ts
export const salePaymentSchema = z.object({
  tender: posTenderSchema, // 'cash' | 'pos1' | 'pos2' | 'transfer'
  amount: moneySchema.positive(),
});
export const saleInputSchema = z
  .object({
    lines: z.array(saleLineSchema).min(1),
    discount: moneySchema.min(0),
    payments: z.array(salePaymentSchema).min(1),
  })
  .refine((v) => {
    const subtotal = v.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    const total = Math.max(0, subtotal - v.discount);
    const paid = v.payments.reduce((s, p) => s + p.amount, 0);
    return paid === total; // exact match, no tolerance
  });
```

Yes — one sale can hold an array of payment rows (`payments: SalePayment[]`, `min(1)`), and the sum being exactly equal to the total is enforced **twice**: once in this Zod refinement (client-side, at form-submit time) and again defensively inside `completeSale` in the mock adapter (throws `'Payments don't add up to the total — check the split.'`). The new card-split UI (Part A) only changes _how the UI builds this array before submitting it_ — the array shape and the exact-sum rule are identical to before.

**18. Refunds — original tender vs. refund tender.** **Not recorded separately, and not linked at all.** `RefundInput.tender` (`finance.ts`) is a free choice from the full `tenderSchema` (`cash, pos1, pos2, transfer, stripe`) with **no field anywhere referencing what the original sale's tender was**, and no check anywhere in `createRefund` (`mock.adapter.ts`) comparing them. The refund lookup does resolve the _sale's total and date_ (to bound the amount and check the return window) but never reads or stores the sale's tender. So today, nothing stops a cash refund against a card sale, or vice versa — this is unchanged from the earlier extraction.

**19. Float and petty cash — entries, and day open/close.** A flat list of entries, no formal "close the day" concept:

```ts
export const cashEntryKindSchema = z.enum(['float-open', 'petty-in', 'petty-out']);
export const cashEntryInputSchema = z.object({
  date: isoDateSchema,
  kind: cashEntryKindSchema,
  amount: moneySchema.positive(),
  note: z.string().trim().min(2),
  staffName: z.string().trim().min(1),
});
export const cashEntrySchema = cashEntryInputSchema.extend({ id: idSchema, at: isoDateTimeSchema });
```

There is a `'float-open'` entry kind (recorded once per trading day, prompted for on first admin visit via `FloatPrompt`/`useAdminStore.floatPromptDismissedOn`), but **no `'float-close'` or equivalent** — nothing in the schema represents "the day was closed out" or "the drawer was counted." `CashView` computes an `expected` figure (`float + petty-in − petty-out + today's cash takings`) and displays it as a target; there is no field anywhere that records an actual counted amount or a variance against that expected figure (confirmed again at this HEAD — `cash-view.tsx` unaffected by the recent diff). So: entries are a flat append-only list, keyed by `date` + `kind`, with no day-boundary record beyond the presence-or-absence of a `'float-open'` row for that date.

**20. Trade-in payouts — representation, and revenue exclusion.** Unchanged from the earlier extraction: `createTradeInPayout` posts a **negative** `Transaction` with `stream: 'trade-in'` (`amount: -input.amount`), and every revenue aggregation (`getAnalytics`'s `summariseTransactions`, `getTodaySummary`, the new `getTodayReport`) filters to `t.amount > 0` before summing — so trade-in payouts are structurally excluded from every revenue/sales figure by virtue of being negative, not by a special-cased stream check. They still appear in the raw `listTransactions` ledger.

**21. Every money field — integer pence audit.** Checked every `Money`-typed and money-shaped field across all 16 type files at current HEAD. **Every single one uses `moneySchema = z.number().int()` (integer pence) — no float, no string, no pounds-decimal field exists anywhere in the domain.** Full list: `Product.price`, `StockMeta.costPrice`, `CartLine.unitPrice`, `Order.subtotal/deliveryFee/discount/total`, `Job.quote`, `RepairType.base.{original,oem,copy}`, `RepairQuote.price`, `Booking.price`, `SellRequest.estimate`, `SaleLine.unitPrice/listPrice/costPrice`, `SalePayment.amount`, `Sale.subtotal/discount/total/cost`, `TodaySummary.total`, `TodaySale.total` _(new)_, `TodayTender.total` _(new)_, `TodayReport.total/averageSale` _(new)_, `PromoTier.unitPrice`, `Transaction.amount/cost`, `CashEntry.amount`, `Refund.amount`, `ReturnLine.unitPrice`, `TradeInPayout.amount/resalePrice`, `ShopSettings.floatTarget`, `AnalyticsSummary.revenue/cost/profit/avgSale/prevRevenue/prevProfit`, `RevenuePoint.shop/repair`, `CategoryRevenue.revenue`, `TenderTotal.total`, `DeliveryOption.price` (`lib/config.ts`, same `Money` type). **No defect found** — this remains true after the recent diff (all new fields added this session, `TodaySale.total`/`TodayTender.total`/`TodayReport.total`/`.averageSale`, all use `moneySchema` correctly). The one non-money numeric that could be mistaken for one: `AnalyticsSummary.margin` is a plain `z.number()` 0–1 fraction (correctly _not_ a money field, it's a ratio), and `Device.priceMultiplier` is a plain positive `z.number()` scalar (also correctly not money).

## Repairs

**22. Phone models, repair types, quality tiers — shape and pricing.** Unchanged from the earlier extraction (`repair.ts`, `mock/repairs.ts` not touched by this diff):

```ts
Device = { id, name, brand: 'apple' | 'samsung' | 'pixel' | 'other', priceMultiplier: number };
RepairType = { id, name, desc, time, base: { original, oem, copy: Money } | null };
PartTier = { id: 'original' | 'oem' | 'copy', name, strap, line, warranty };
```

Real fixture (`mock/repairs.ts`):

```ts
{ id: 'ip14', name: 'iPhone 14', brand: 'apple', priceMultiplier: 1.15 }
{ id: 'screen', name: 'Screen replacement', desc: 'Cracked glass, dead pixels, ghost touch',
  time: '40–60 min', base: { original: 14000, oem: 10500, copy: 7200 } }
{ id: 'original', name: 'Original', strap: 'Pulled or service-pack parts from the manufacturer.',
  line: 'Identical to factory...', warranty: '12-month warranty' }
```

Price is **on the combination**, computed, not stored per-combination: `price = round(repairType.base[tierId]/100 × device.priceMultiplier) × 100`. So the "price" isn't a cell in a device×repair×tier matrix table — it's one `base` triple stored on the `RepairType`, multiplied by a scalar stored on the `Device`. Water damage/data recovery/"other" all have `base: null` → always diagnosis-only, no price at any tier.

**23. Job stages — current list, and "waiting for approval"/"sent back".** Current list, unchanged by this diff: `jobStatusSchema = z.enum(['new', 'in-progress', 'done', 'collected'])`, strictly linear (`nextJobStatus` only ever returns the next one or `null`, no backward move). **Neither "waiting for approval" nor "sent back" exist as job statuses or as any other field.** Nothing in `JobPatch`/`updateJob` represents a customer-approval gate or a returned-to-customer step — this is the same gap noted for `Booking`'s `dispatched` status (which also has no tracking/return-postage field behind it).

**24. Mail-in vs. walk-in distinction on jobs.** Already exists, unchanged: `JobSource = z.enum(['walk-in', 'mail-in', 'online'])` on every `Job`. `createJob` (the only job-creating adapter method) always writes `'walk-in'` — nothing in the current contract creates a `mail-in` or `online` job; per `NOTES.md`/`INTEGRATION.md`, linking a `Booking`/`Order` to a `Job` with the right `source` is explicitly left as backend work (no `bookingId`/`orderId` field exists on `Job` to do that linking with yet).

**25. Deposits — flag or amount?** Flag, not amount, unchanged: `jobPaymentSchema = z.enum(['unpaid', 'paid-advance', 'paid'])` — a tri-state label with **no numeric field anywhere** recording how much was paid in advance vs. owed. `Booking` (mail-in repair) has no payment field at all. If partial-payment amounts matter for the real schema, that's new design, not a port of an existing (if incomplete) field.

## Documents and uploads

**26. Every upload point.** Unchanged from the earlier extraction — three, all filename-only mocks:

| Attaches to                                                    | Accepted types (enforced?)                                                                                                   | Multiple?                       | Metadata                              |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------- |
| `Order.verification.{registrationDoc, licence}` (plate orders) | UI copy says "PDF or image"; **not enforced in the Zod schema** (just non-empty strings)                                     | No — exactly one file per field | Filename only, no size/MIME/timestamp |
| `AdminProduct.buyInForm` (local buy-ins)                       | Not constrained                                                                                                              | No — single string              | Filename only                         |
| `Product.images`                                               | `ProductInput.images` has no URL/type constraint (the stricter `.url()` check is only on the _read_ model, `Product.images`) | Yes — array                     | Filename/ref only                     |

**27. Approval state on uploaded documents.** Does not exist. No status field anywhere (`order.ts` unchanged by this diff) — `createOrder` sets `status: 'paid'` immediately regardless of whether `verification` is present, so there's no "awaiting document review" state to attach an approval flag to even in principle. Same for `AdminProduct.buyInForm` — no `pending/approved/rejected` field.

## Settings and permissions

**28. `ShopSettings` in full, with current default values** (`settings.ts` + `DEFAULT_SETTINGS` in `mock/admin.ts`, both current at HEAD):

```ts
export const shopSettingsSchema = z.object({
  returnWindowDays: z.number().int().min(0), // default: 30
  idleLockMinutes: z.number().int().min(1), // default: 5
  adminPin: z.string().regex(/^\d{4}$/), // default: '1234'
  floatTarget: moneySchema, // default: pounds(150) = 15000
});
```

Four fields — down from five; `lowStockThreshold` was removed this commit (Part A). No per-field audit trail (who changed a setting, when) exists.

**29. Config outside Settings that arguably belongs in it.** All in `lib/config.ts` / `lib/data/promo.ts` / `lib/payments/provider.ts`, none editable at runtime:

- `RETURN_WINDOW_DAYS = 30` (`lib/config.ts`) — a **second, separate, hardcoded** return-window value, distinct from `ShopSettings.returnWindowDays` even though both currently equal 30. Storefront copy (receipt, auth panel, PDP, returns-policy page) reads this constant; the till's actual refund-window enforcement (`createRefund`) reads the Settings value. Two sources of truth for one concept — flagged again in Part C §7.
- `DELIVERY_OPTIONS` (collect £0, standard £3.95, next-day £6.95, remote £9.95) — a fee table, currently source code.
- `POS_CONFIG.blockBelowCost = false` — a single boolean toggle, currently source code.
- The demo promo code `FIXED10` (`lib/data/promo.ts`) — hardcoded, described in its own comment as deliberately not meant to grow into real config.
- `PAYMENT_PROVIDERS` (`stripe`/`clearpay` labels and blurbs, `lib/payments/provider.ts`) — which payment methods are offered at all, currently source code, not a settings toggle.

**30. Current permission list — every tab and action** (reproduced in full in Part A Q1 above; not repeated here). Seven POS tabs (`Checkout, Jobs, Inventory, Promotions, Cash, Trade-ins, My day`), all mapped 1:1 to a `Permission`, all currently granted to both employee roles equally. Eight management-only permissions with **no dedicated tab of their own listed in `POS_TABS`** (`costs.view, analytics.view, payments.view, reports.view, returns.manage, labels.manage, staff.manage, settings.manage`) — these gate `/admin/*` screens instead, which (Part A / earlier extraction) have no permission enforcement in code at all, unlike the POS tabs.

## Lists and search

**31. Filter/sort/search/pagination per list, and expected response shape.** Checked `DataTable` (`components/admin/data-table.tsx`, unaffected by this diff) directly — it is the single component every admin/POS list renders through. Findings:

- **Server-side params:** only `listProducts(query?: ProductQuery)` (`category`, `search`, `sort`) and `listTransactions`/`getAnalytics` (`from`, `to` date range) take any argument at all. Every other list method — `listAdminProducts, listJobs, listPromotions, listStaff, listLabelTemplates, listCashEntries, listRefunds, listTradeInPayouts, listOrders, listBookings, listSellRequests` — takes **zero arguments** and returns the full table, unpaginated, every time (unchanged by this diff; the new `OrdersView` calls `listOrders()` the same bare way).
- **Client-side filter/sort/search/pagination, uniformly:** `DataTable` does _all_ of sorting (`getSortedRowModel`), filtering (`getFilteredRowModel`), and pagination (`getPaginationRowModel`) via TanStack Table, entirely in-browser, over whatever array it was handed. `pageSize` defaults to 10, is passed per-screen (Orders panel uses 12). There is no `Paginated<T>`/cursor/page-number concept anywhere in the actual request/response contract — `Paginated<T>` exists in `common.ts` and is never used.
- **Response shape every list method returns:** a bare array, `T[]` — never `{ items, total }`, never a cursor, never a page token.
- The new Orders panel adds one extra layer of **client-side, not server-side** filtering on top of `DataTable`'s own search: a local `filter` state (`'todo'|'all'|OrderStatus`) that slices the already-fully-fetched `Order[]` array before handing rows to `DataTable`.

**32. What fields are actually searched — the indexing question.** For **every single list in the app**, unless a screen supplies a custom `globalFilterFn` — and a repo-wide check found **not one admin/POS component does** — the search box runs this, verbatim, per row, per keystroke:

```ts
JSON.stringify(row.original).toLowerCase().includes(query.trim().toLowerCase());
```

That means the "search" on every list (products, orders, jobs, inventory, staff, promotions, trade-ins, refunds, cash entries, label templates) matches against the **entire serialized row** — every field on the object, including ones not shown in any column (e.g. an order's `email`, a job's `notes`, a refund's `reason`), not a curated subset. There is no per-column "searchable: true/false" concept, and nothing here implies which columns should be indexed server-side — it implies the opposite: the frontend currently has no informed opinion about which fields matter for search, because it searches everything indiscriminately. The **backend** will need to make that call itself (a real full-text/trigram index across name/reference/customer fields would functionally replace this, at a fraction of the cost of literally serializing every row to JSON per keystroke — see Part C §6 for why that specific pattern won't survive a large table anyway).

---

# PART C — Problems, stated plainly

**1. Uniqueness — what must be unique, and where the code would currently allow a duplicate.**

- **Reference numbers** (`Order.reference`, `Booking.reference`, `SellRequest.reference`, `Sale.reference` — all drawn from one shared module counter) and **job references** (a second, independent module counter, same `"FNL-nnnn"` format) and **trade-in payout references** (`"BUY-nnnn"`, a third counter) are all just in-memory counters that reset on every page reload (`NOTES.md`'s own words: "the mock DB is module state — a full page load resets it"). Nothing enforces uniqueness at the data layer — the mock is "unique" purely by luck of being single-user, single-session, non-persistent. A real backend needs an actual unique constraint (DB sequence or a uniqueness-checked insert), and needs to decide whether jobs and orders sharing the `"FNL-"` format is meant to stay that way (in which case they need ONE sequence between them) or whether it was accidental (two counters, same-looking output).
- **Barcodes** (`StockMeta.barcode`) — no uniqueness check anywhere; two products could be saved with the same barcode string today with no error. Given barcodes are how a USB scanner resolves a product at the till, a real duplicate would misresolve at the point of sale.
- **Staff email** (`staffSignIn` matches by email, case-insensitively) — nothing in `staffInputSchema`/`createStaff` stops two staff rows sharing an email; if that happened, `staffSignIn`'s `.find()` would silently always resolve to whichever one comes first in the array, logging the other person in as the first.
- **Product slug** (`Product.slug`, used as the PDP URL and as `generateStaticParams`'s key) — `buildAdminProduct` derives the slug from the name (`name.toLowerCase().replace(...)`), so two products with the same/similar name would collide on slug with no check or disambiguation.
- **Settings** — singleton by construction in the mock (`adminDb.settings` is one object), but nothing in the schema itself expresses "there is exactly one settings row" as a database-level constraint; that has to be designed in (e.g. a fixed single-row table or a `shop_id` key even if there's only one shop today).

**2. Time zones — every place "today" is calculated, and why it will drift.**
The shop is UK, observes BST; nothing in the code pins a timezone anywhere. Every "today" boundary uses the **local clock of whatever machine runs the code**:

- `getTodaySummary` / `getTodayReport` (`mock.adapter.ts`): `const today = new Date(); today.setHours(0,0,0,0)` — local midnight.
- Analytics bucketing (`mock/analytics.ts`): `parseIsoDay("YYYY-MM-DD")` builds a **local** `Date`; `mondayIndex()` uses local `.getDay()`; hour-of-day for the busiest-times heatmap uses local `.getHours()`.
- `CashView`'s "today" (`lib/dates.ts` `isoDay()`) — local calendar day.
- `FloatPrompt`'s "has today's float been opened" check — same local-day logic.
- **The busiest-times chart specifically**: `BusyCell { day, hour, count }` buckets every settled sale by local weekday and local hour. If the server that eventually computes this runs in UTC (the Coolify/Docker default, per `NOTES.md`'s own deployment notes) while the shop trades in `Europe/London`, every sale between local midnight and 1am in winter (or between 11pm and midnight in summer, during BST) will land in the wrong day's bucket, and every hour-of-day figure will be off by a full hour for roughly half the year (whenever BST is in effect, since the server won't observe it). This needs an explicit decision — store timestamps in UTC (already true — `isoDateTimeSchema` is UTC by convention, `Z`-suffixed) but **convert to `Europe/London` at the point of aggregation**, not silently inherit the process's `TZ`.

**3. Concurrency — every place two people acting at once produce a wrong number.**

- **Stock** (the obvious one): `completeSale` and `adjustStock` both do a plain read-modify-write on `stockQty` (`product.stockQty = Math.max(0, product.stockQty - line.quantity)`), with no locking, version check, or atomic decrement. Two POS terminals selling the last unit of the same product simultaneously would both see `stockQty: 1`, both succeed, and the count would go to `-1` in spirit (clamped to 0 by the `Math.max`, silently hiding the oversell rather than rejecting the second sale).
- **`adjustStock` and `completeSale` racing each other** on the same product — same problem, different code paths, same underlying field.
- **`updateOrderStatus`** (new this commit): reads `order.status`, checks it against `nextOrderStatuses`, writes a new status — no optimistic-lock/version field on `Order`, so two staff clicking two different "next step" buttons on the same order at once (e.g. one clicks "Mark shipped" while another clicks "Cancel") would both pass the guard check against the same stale `order.status` and the last write wins silently.
- **Reference-number generation** (§1 above) — two simultaneous checkouts calling `nextReference()` are safe _only_ because JS is single-threaded in the browser; a real server handling concurrent requests needs an actual atomic sequence, or two customers could receive the same order reference.
- **The float-open prompt** — `adminDb.settings`-adjacent, `CashEntry` `kind: 'float-open'` — nothing stops two staff both recording an opening float for the same day if they both load the dashboard before either submits; the UI's "first visit of the day" check is a client-side read of the existing entries, not a server-enforced uniqueness rule.

**4. Money rounding.**

- **Repair/quote pricing**: `round(basePence/100 × device.priceMultiplier) × 100` — rounds to whole pounds, so any fractional pence from the multiplier is deliberately discarded before it can appear (by design, matching the prototype's whole-pound display).
- **Promo discount** (`applyPromo`): `Math.round((subtotal × promo.value) / 100)` for percentage codes — standard half-up rounding, fine, but the single demo code (`FIXED10`) is the only case exercised; a real percentage-based promo engine would hit this same rounding on every order and should decide a consistent rounding rule (bankers' vs. half-up) once, not per promo type ad hoc.
- **Split-payment cost allocation** (`completeSale`): pro-rates `cost` across payment portions (`costShare = round(cost × payment.amount / total)` for every portion except the last, which absorbs `costRemaining`) — this specific pattern avoids a rounding leak _for cost_, deliberately.
- **No equivalent per-line discount allocation exists anywhere** — `SaleInput.discount` is a single order-level pence amount, never split across `SaleLine`s. If the real schema needs per-line discount (e.election for margin reporting by product), that rounding problem hasn't been solved by any existing code — it would be new.
- **Split payments summing to the total** is enforced by **exact integer equality** (`paid === total`), so there's no fractional-penny tolerance issue by construction — the risk is entirely on the _input_ side (can the UI even construct a set of portions that sum exactly, given `setPaymentAmount` rounds each portion independently to the nearest penny via `Math.round((Number(amountPounds)||0) * 100)`) — worth checking during backend design that whatever UI/rounding replaces this doesn't make hitting an exact sum harder than it needs to be.

**5. Ordering the code depends on without saying so.**

- **`getTracking`**: checks bookings, then orders, then sell requests, in that fixed sequence, returning the first match — this only "works" because references are unique across all three today (shared counter, §1); if that assumption ever breaks, the lookup order silently decides which record wins, with no error or warning.
- **`promoUnitPrice`**: sorts eligible tiers by `minQty` descending and takes the first (`eligible[0]`) — correct today because tiers are small hand-entered arrays, but nothing stops two tiers being saved with the same `minQty` and different prices, in which case array-insertion order (not any declared priority) would silently decide which one wins.
- **`createRefund`'s counter-sale resolution**: sums _all_ `adminDb.transactions` rows sharing a reference where `amount > 0 && stream === 'shop'`, then takes the _earliest_ `at` among them as the sale time (`rows.reduce((earliest, t) => t.at < earliest ? t.at : earliest, rows[0].at)`) — implicitly assumes all rows sharing a reference belong to one sale (true today only because `completeSale` is the only writer of `stream: 'shop'` rows with that reference format) and that "earliest timestamp among the portions" is close enough to "true sale time" (portions are written in a tight loop in the mock so this is fine there, but is an assumption a real system with network latency between payment portions might not get to keep).
- **`getTodayReport`'s and `getTodaySummary`'s `Set`/`Map`-by-reference grouping**: both assume every transaction row that shares a `reference` is part of the same logical sale and should be summed together — true only as long as reference numbers are never reused across different sales (again, §1's counter uniqueness assumption, now load-bearing in two more places).
- **Analytics series bucketing**: builds an ordered array of empty buckets first (`while (cursor < toExclusive)`), then fills them by matching a `Map` key — correct only because the cursor loop and the transaction-matching loop use the _identically formatted_ key (`toIsoDay(cursor)` vs `toIsoDay(new Date(t.at))` for day buckets) — any drift in how those two dates are constructed (e.g. one becoming timezone-aware and the other not) would silently drop transactions into no bucket at all rather than erroring.

**6. Adapter methods that won't survive a real database.**

- **Eleven-plus bare `listX()` methods with zero parameters**, returning the entire table every call (§31) — the single biggest structural issue. `listAdminProducts`, `listJobs`, `listOrders` (now also driving the new Orders panel), `listStaff`, `listPromotions`, `listLabelTemplates`, `listCashEntries`, `listRefunds`, `listTradeInPayouts`, `listBookings`, `listSellRequests` all need pagination/filtering added at the contract level before they can point at a real table with meaningful row counts.
- **The `JSON.stringify(row).includes(query)` search pattern** (§32) needs data the server has to fetch client-side today (the whole table) to search at all — it cannot become a server-side search without the frontend also changing (search becomes a query param, same as `listProducts`'s `search` already is) — worth noting because Part A/B show that pattern (`ProductQuery.search`) already exists and works; the other 10+ lists just never got it.
- **`getTracking(reference)`** — a linear fan-out scan across three separate arrays with no shared index — needs either one physical reference-number table spanning all reference-issuing entities, or three properly indexed lookups plus a way to know which table to check first (today's fixed booking→order→sell-request order is arbitrary).
- **`adjustStock`** — no idempotency key, so a real network retry (client resent a request that actually succeeded) would double-apply the delta; needs either an idempotency token or a move to absolute-value semantics with an expected-previous-value check.
- **`updateJob`/`updateOrderStatus`** — both optimistic-UI-with-rollback on the frontend, both currently have no version/ETag concept, so the backend can't tell "reject because stale" from "reject because business rule" without adding one.
- **`getTodayReport`/`getTodaySummary`** — both scan `adminDb.transactions` in full and filter by timestamp in application code; a real implementation needs a `created_at >= today` index at minimum, and (per §5) needs to replicate the exact "group by reference" semantics or the two endpoints will disagree with each other, which `INTEGRATION.md` explicitly warns against.

**7. Modelled inconsistently in two places.**

- **Return window**: `RETURN_WINDOW_DAYS` (hardcoded constant, drives storefront copy) vs. `ShopSettings.returnWindowDays` (configurable, drives actual refund-window enforcement) — two fields, same meaning, one editable and shown nowhere to the customer, one fixed and shown everywhere to the customer. Restated from the earlier extraction because it is unaffected by, and structurally identical to, the low-stock-threshold problem this commit just _fixed_ by deleting the duplicate (`ShopSettings.lowStockThreshold` vs. the per-product field) — the return-window duplication is the same shape of bug, still unresolved.
- **Barcodes**: `StockMeta.barcode` (per product, meant to be the manufacturer's EAN/UPC per its own comment) vs. `LabelTemplate.barcode` (a freestanding string typed into the label designer, unconnected to any product) — two barcode-shaped fields in the schema with no relationship between them.
- **Delivery fee**: `INTEGRATION.md`'s documented flat £2.99 vs. the actually-used tiered `DELIVERY_OPTIONS` (£3.95/£6.95/£9.95) — a stale doc pointing at dead code (`pricing.ts`'s unused `DELIVERY_FEE` constant), not a live inconsistency in the running code itself, but still a trap for whoever reads the doc instead of the code.
- **`getTodaySummary.sales` vs. `getTodayReport.salesCount`**: this commit made these agree in _meaning_ (both now count distinct references), but they remain **two separate computations of the same number**, run independently, over the same underlying data — `INTEGRATION.md` had to add an explicit instruction telling the backend to keep them in sync, which is itself a signal they're modelled as two things rather than one thing exposed twice.
- **Sale line items vs. ledger rows**: a POS sale is recorded as N `Transaction` rows (one per payment portion, each carrying the whole sale's reference and a pro-rata cost slice) but the actual `SaleLine[]` (which products, what quantity) is never persisted anywhere beyond the `Sale` object returned to the browser for the receipt — restated from the earlier extraction, still true, and now also the reason `createRefund`'s counter-sale path and the new `getTodayReport`'s sale list can only show a total per reference, never line-level detail, for a counter sale.
