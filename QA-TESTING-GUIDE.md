# QA testing guide — checkout / trade-in / refund fixes

**Branch:** `fix/checkout-tradein-refund-copy-fixes`
**Repo:** [FONOLOGY-UK/FONOLOGY](https://github.com/FONOLOGY-UK/FONOLOGY)
**Open the PR:** https://github.com/FONOLOGY-UK/FONOLOGY/pull/new/fix/checkout-tradein-refund-copy-fixes
**Environment:** dev only (`ohkvwqqtppvnxbvvdsfr`). Nothing here touches production.

## Setup

```bash
git fetch origin
git checkout fix/checkout-tradein-refund-copy-fixes
pnpm install
```

Run both apps from the repo root (turbo runs `api` on :4000 and `web` on :3000 together):

```bash
pnpm dev
```

**Test accounts:** password `Test1234!` for all three. Full details (including a seeded guest order and two deliberate catalogue edge cases) are in `TEST-LOGINS.md` at the repo root — gitignored, not in this branch, ask the project owner if you don't have it locally.

- `owner@fonology.test` — sees Reports, Returns, everything
- `staff@fonology.test` — counter account, locked out of Returns/Reports
- `customer@fonology.test` — normal shopper, no staff access

Staff sign-in is at `/staff-login`, customer sign-in at `/login`.

---

## 1. Bag drawer delivery hint

**Before:** flat "delivery £2.99" regardless of the real rate.
**After:** "delivery from £3.95", sourced from the same config the product page uses.

1. Go to `/shop`, add any in-stock item to the bag.
2. Open the bag (bag icon, top right).
3. Check the line under the subtotal: should read **"Free click & collect from the counter · delivery from £3.95"**.
4. Compare against a product detail page's "Delivery & returns" accordion — the standard-delivery figure should match.

## 2. Trade-in device names

**Before:** requests without a free-text "something else" device showed a raw UUID instead of the phone name.
**After:** real device name everywhere.

1. Sign in as `owner@fonology.test` → `/admin/trade-ins`.
2. Look at the **Device** column for every row — none should be a UUID (a long `xxxxxxxx-xxxx-...` string). Either a real device name (e.g. "iPhone 14") or customer-entered free text.
3. Click into any request with a real device (not "something else") — the page title should show the device name, not a UUID.
4. If that request has a payout recorded, check the payout panel — the device label there should also be a real name, not a UUID (this was the worse half of the bug: a UUID could become the _permanent_ label on a payout, and the pre-filled "shelf name" if that device gets restocked).

## 3. Sell-flow "Prototype only" copy

**Before:** step 3 said "Prototype only — nothing is sent yet" even though submission genuinely worked.
**After:** honest copy; submission still works exactly as before.

1. Go to `/sell`, pick any device, fill in condition, contact details.
2. On the final step, before submitting, check the small print under the "Get my offer" button — should say **"Submitting sends this to us for real, with a trackable reference..."**, not "Prototype only."
3. Submit. Confirm you land on a success screen with a real reference (format `FNL-#####`, not `FNL-0000`).
4. Optional: sign in as `owner@fonology.test`, check `/admin/trade-ins` for that reference.

## 4. Repair-flow "Prototype only" copy

Same bug, same fix, on the repair booking flow.

1. Go to `/repair`, pick a device → a problem → a part grade → fill in contact details.
2. On the final step, check the small print under "Start my repair" — should say **"Submitting sends this to us for real, with a trackable reference — we'll follow up with a prepaid shipping label."**
3. Submit. Confirm a real reference appears (not `FNL-0000`).
4. Go to `/track`, enter that reference and the email you used — confirm it shows up with status "Received" and the correct device/repair/estimate.

## 5. Refund amount field

**Before:** the field is pre-filled `0.00` (or a computed total); typing a number without manually clearing first appended instead of replacing — e.g. typing `72` produced `0.0072`.
**After:** typing replaces the pre-filled value, every time.

1. Sign in as `owner@fonology.test` (staff accounts are gated out of Returns) → `/admin/returns`.
2. Click **"No receipt"** (fastest path to the amount field without needing a real order reference).
3. Click directly into the **Refund amount (£)** field — do **not** clear it manually first.
4. Type `72`. The field should show `72`, not `0.0072`.
5. Click away, click back into the field, type `15.50` without clearing. Should show `15.50`, not a concatenation of the old and new values.
6. Repeat once more with a different number to be sure it's not a one-time fluke.

_(Do not actually submit the return unless you want a real refund record in the dev database — the field behaviour is the thing being tested, not the submission.)_

## 6. Dead code removal (nothing to click)

`DELIVERY_FEE` was an unused constant in `apps/web/src/lib/data/types/pricing.ts` — the likely origin of bug #1 above. It's been deleted. Nothing to test in the browser; just confirms the codebase builds clean (see verification below).

## Watch item — NOT part of this branch, no fix applied

**Staff-login click bug** (reported: a normal mouse click on `/staff-login`'s "Sign in" sometimes does nothing). Investigated thoroughly — the button, form, and hydration timing were all checked and found correct, and it could not be reproduced across 4 real-click trials (both `owner@fonology.test` and `staff@fonology.test`, immediately after page load and after a few seconds' wait). No code change was made because no defect was found. **If your checker hits this during genuine manual testing** (not automated tooling), the single most useful thing they can do is capture a HAR file (browser DevTools → Network tab → right-click → "Save all as HAR") at the moment it happens — that's the one thing that could actually explain it if it's real.

---

## Verification already run (repeat if you want to double-check)

```bash
# from repo root
pnpm --dir apps/web run typecheck
pnpm --dir apps/api run typecheck
pnpm --dir apps/web run lint
pnpm --dir apps/api run lint
```

All four were clean before this was pushed.
