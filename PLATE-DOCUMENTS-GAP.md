# Number plate verification documents — gap closed

**Status:** BUILT and verified against the dev database. Not yet deployed to staging.
**Raised by:** independent code audit (finding CRIT-02), verified 2026-09-01.
**For:** Raja — this is a notification, not a request. Nothing here needs a decision.

---

## What was wrong

The checkout's "Verify your number plate" step captured only the filename:

```tsx
onChange={(e) => setRegDoc(e.target.files?.[0]?.name ?? '')}
```

That string was sent to `POST /orders` and written straight into
`order_documents.storage_path`. **No file was ever uploaded.** Every plate order
produced two rows pointing at objects that did not exist. The staff approval screen
could never show anything, and the customer was told "Uploaded" — plus a promise about
secure storage and 30-day deletion — for a file that never left their browser.

No customer was ever affected: production has never gone live and no real plate order
has ever been placed. This was an unfinished feature, not an incident.

## What was built

Only the upload was missing — the table, the private bucket, signed-URL viewing, view
auditing, the approval screen and the 30-day purge job all already existed.

| Piece                                                  | Where                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| Upload lib (type + size limits, server-side)           | `apps/api/src/lib/orderDocuments.ts`                              |
| Public upload endpoint, rate limited                   | `POST /orders/documents`                                          |
| Key validation + existence check before order creation | `apps/api/src/routes/orders.routes.ts`                            |
| Orphan sweep for abandoned checkouts                   | `purgeOrphanedOrderDocuments`, wired into the existing purge cron |
| Real upload UI with truthful state                     | `checkout-flow.tsx`                                               |

### Sequencing

Documents are uploaded **before** the order exists, in a separate call that returns an
opaque storage key. The key travels through the existing `verification` field, and
`POST /orders` verifies each key is one the API minted **and** that the object really
exists before creating anything.

The alternatives were both worse: creating the order first leaves a real plate order
with no documents if the upload then fails (the exact bug being fixed), and sending
files inside `POST /orders` as multipart means a failed 4MB upload discards the basket
and delivery quote with it. This way a failed upload fails early and alone, with the
basket intact and no order written.

### Because this endpoint is public

It accepts identity documents from unauthenticated members of the public, so:

- **Type and size enforced server-side** by multer before any handler runs — PDF, JPEG,
  PNG, WebP, HEIC/HEIF, 8MB cap. The input's `accept` attribute is a file-picker
  convenience, not a control. HEIC is included deliberately: an iPhone photographing a
  V5C produces HEIC by default, and rejecting it would fail the most likely real upload.
- **Rate limited** — 20 per IP per 10 minutes, verified firing exactly at the cap.
- **Private bucket, verified not assumed** — `id-documents` is `public: false` and has
  **no** storage policy at all; only `product-images` has a public-read policy. Access
  is service-role only, through short-lived signed URLs.
- **The storage key is minted server-side** from a UUID. The customer's filename is
  discarded rather than echoed into the bucket — a filename can itself be identifying
  ("dave-smith-licence.jpg") and nothing in the staff flow needs it.
- **Client-supplied keys are a trust boundary.** Order creation accepts a key only if it
  matches the pattern this API mints _and_ the object exists. Without that, a caller
  could write any string into `order_documents.storage_path`.
- **Abandoned uploads are swept.** A checkout that is never completed leaves a real
  driving licence in storage with no `order_documents` row — which the existing
  retention job could never see, because it works from the table. Anything unreferenced
  and older than 6 hours is deleted.

### The UI no longer lies

"Uploaded" appears only once a storage key has come back from the server. The states are
`Uploading…`, `Uploaded`, or the actual error. Continue is blocked until both documents
genuinely exist server-side. The privacy notice ("private, admin-access only, deleted
after 30 days") is now true as written, so it stays.

Separately: the `order_documents` insert error used to be discarded entirely. It is now
fatal and loud — a plate order whose document rows failed to write is exactly this bug
in miniature. No payment is at risk, because the order is still `pending` at that point.

## Verified end to end against dev

Real files, real bucket, real order:

- PDF and PNG uploaded → real objects in `id-documents` at the right sizes and MIME types
- `.txt` rejected (400), unknown document kind rejected (400)
- Forged-but-well-formed key → order refused, **no order created**
- Path-traversal key (`../product-images/../../etc/passwd`) → refused
- Real keys → order `FNL-10585` created, both `order_documents` rows pointing at objects
  confirmed to exist
- Signed URLs minted and fetched — both documents came back **byte-identical** to what
  was uploaded (193-byte PDF, 95-byte PNG)
- Anonymous access to the same object → denied
- Orphan sweep: aged orphan deleted, attached documents untouched
- Rate limit fires at the cap

All test data was removed afterwards and the database returned to its pre-test state.

## Still to do

1. **Deploy to staging and repeat the check through the browser.** The verification
   above ran against a local API pointed at the dev database, which exercises the real
   code path and real storage but not the deployed one. Deploying needs Tanoli's OK.
2. **Migrations before API.** See the deploy-order note in the report — unrelated to this
   feature but it ships in the same batch.
3. **Plates remain purchasable online.** The `in_store_only` flag is a one-column update
   and is the same mechanism vapes use, so gating them is trivial if wanted. It was not
   applied: production is paused so there is no exposure to protect, and setting it on
   dev would have blocked the end-to-end test above. If this work is _not_ deployed
   before go-live, set it on production before opening the shop.
