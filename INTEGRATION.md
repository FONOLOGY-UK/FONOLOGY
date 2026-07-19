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

Admin/POS **mutations** (status changes, product CRUD, refunds) are added to
`DataAdapter` as those panels are built (items 8–12). When you know a mutation
the backend will expose, tell us and we'll add it to the contract early so the
UI is built against the final shape.

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
