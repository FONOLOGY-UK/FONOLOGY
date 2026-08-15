# Handover — printing, for Kashir

Everything here was built by Tanoli. You own the backend and have not seen any of it. This
document is written so you can pick it up cold, without reading the code first.

**For the rest of the system** — what else is built, what is not wired, the deployment sequence,
and which of the older documents are stale — see
[`HANDOVER-PROJECT.md`](HANDOVER-PROJECT.md). The two are meant to be read together.

It covers what the print system is, why it is shaped the way it is, the one subtle guarantee
that must not be broken, what is proven and what is only reasoned, and — at the end — the
checklist of everything that must happen before any of this goes live.

**Nothing hardware-facing has ever run against a printer.** No printer has been plugged in.
Everything below is either measured at the byte level, verified against a library, or reasoned
from source, and it says which.

---

## 1. What it is

Two physical devices sit in the shop in Glasgow:

- **Brother QL-600** label printer — USB only, DK label rolls
- **eposnow POS80GXa** thermal receipt printer — 80mm, ESC/POS

Three pieces make printing work:

```
apps/api            print queue endpoints          Germany (Hetzner VPS)
supabase            print_jobs / print_agents      the durable queue
apps/print-agent    the process that prints        Glasgow, on the till PC
```

### Why a separate agent at all

Two independent reasons, and a design solving only one of them would fail in the shop.

**A browser cannot drive a printer.** JavaScript in a tab cannot open a raw TCP socket to a
printer's port 9100, and cannot write to a USB device as a printer. This is true regardless of
cable type — it is the actual origin of the "local agent" pattern, not the USB-vs-LAN question.

**The backend is not in the shop.** `apps/api` runs on a VPS in Germany. The printers are on a
private LAN behind a consumer router in Scotland. A server in Germany cannot reach them, and
that printer must never be exposed to the internet.

So something must run _inside_ the shop. That is the agent. Because the QL-600 is USB-only, the
agent must run on the PC it is physically plugged into.

### Why it pulls, never receives

The agent asks the API for work. The API never connects to the agent.

A consumer router blocks inbound connections from the internet, so push would need port
forwarding or a tunnel — fragile, and it points the internet at a shop network. An outbound
long-poll crosses any router with zero configuration.

### Why the queue is durable

A receipt whose print silently failed is worse than one that printed late. If the PC is asleep,
the printer is out of paper, or the line is down, the job waits and prints on recovery. Jobs
have explicit states and a terminal failed state that a human can see, rather than a failure
that gets swallowed.

---

## 2. The at-most-once guarantee — read this section twice

**This is the subtle part, and the easiest thing in the whole system to "simplify" into a bug.**

The requirement: a receipt must never print twice. Two receipts for one sale is exactly what a
fraudulent return looks like, and the customer keeps the paper.

**Exactly-once is impossible.** It is the two-generals problem: the agent can print and then die
before it tells the server, and no protocol closes that gap. The code does not pretend otherwise
and neither should you.

What is achieved instead is **at-most-once, plus an explicit state that asks a human.**

### The marker

`apps/print-agent/src/marker.ts`. Read the file header before changing anything near it.

```
marker present → bytes MAY have reached the printer → job becomes `unconfirmed`,
                 a human is asked. Never auto-reprinted.
marker absent  → bytes CANNOT have reached the printer → safe to requeue automatically.
```

`writeMarker()` does four things and **the order is the point**:

1. Write the body to a temp file in the same directory.
2. `fsyncSync` — on Windows this is `FlushFileBuffers`, which pushes data _and_ metadata past
   the OS cache and instructs the drive to commit its own write cache.
3. `renameSync` — atomic within a directory on NTFS, so a reader can never see a half-written
   marker.
4. **Only then** does the caller send a single byte.

`writeFileSync` alone is **not enough**: it returns once the data is in the page cache, and a
power cut between that return and the flush loses the marker while the printer already has the
bytes. That is precisely the double-print case — and a shop PC gets switched off at the wall.

A corrupt or empty marker still counts as **present**. The atomic rename should make that
impossible, but the safety argument must not _depend_ on the rename being perfect.

**Worker ordering — do not reorder:** render → write marker → send → ack → clear marker. Render
is first because it is pure and can fail on an unknown payload, leaving no marker and staying
safely retryable. The marker clears only after the server accepts the ack.

### The receipt/label asymmetry

Server-side, in `apps/api/src/routes/print.routes.ts`:

```
reachedPrinter && target === 'receipt'  →  unconfirmed   (ask a human, never auto-reprint)
otherwise                               →  queued if attempts remain, else failed
```

**A duplicate receipt in a customer's hand is a dispute. A duplicate label is an inch of wasted
roll.** That is the whole justification, and it is why the two targets are treated differently.

`reachedPrinterForStage()` in `hostOutcome.ts` maps host stages to the boolean, and **anything
unrecognised answers `true`**. A stage nobody has thought about must never be treated as safe to
auto-reprint.

### What protects it

**pgTAP `supabase/tests/025_print_queue.sql`.** It asserts the asymmetry directly. If someone
later decides the two targets should behave the same "for consistency", that test fails. Do not
delete it. It passes today.

### What the staff actually see

`unconfirmed` never appears on screen as a word. `/admin/printing` asks:

> **Did this receipt come out of the printer?**
> We lost contact with the printer part-way through, so we cannot tell.
> `[ Yes, it printed ]` `[ No — print it again ]`

Nobody can tell from code whether ink reached paper. The person at the counter can just look.

---

## 3. What is built

### Database

| Migration                   | What                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `0033_print_queue.sql`      | `print_agents`, `print_device_health`, `print_jobs`, atomic `claim_print_job()`, `expire_print_leases()` |
| `0035_refund_reference.sql` | `refunds.reference` (`REF-` series) + backfill + trigger                                                 |

`0035` exists because `refunds` was the only customer-facing record with no reference of its own
— it borrowed the sale's. Invisible on screen; broken on paper, because two partial refunds
against one sale printed the same number. Found while building the refund receipt.

### API — `apps/api/src/`

| File                                                    | What                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `routes/print.routes.ts`                                | Enqueue, long-poll lease, ack, fail, heartbeat, resolve. The state machine is documented at the top. |
| `routes/shop.routes.ts`                                 | Public `GET /shop` — the only unauthenticated endpoint.                                              |
| `middleware/agentAuth.ts`                               | Bearer-token auth, scoped to print endpoints only.                                                   |
| `lib/printPayloads.ts`                                  | Builds the frozen payload for all six kinds, server-side.                                            |
| `lib/printHealth.ts`                                    | `ok / stale / asleep / down / never_seen`, against opening hours.                                    |
| `lib/printNotify.ts`                                    | In-process notifier that wakes parked long-polls.                                                    |
| `lib/printRetention.ts` + `scripts/purge-print-jobs.ts` | Retention (payloads carry PII).                                                                      |

### The agent — `apps/print-agent/`

`src/index.ts` (startup, orphan recovery), `src/worker.ts` (claim → render → marker → send →
ack), `src/marker.ts` (§2), `src/api.ts`, `src/heartbeat.ts`, `src/instance.ts`
(single-instance lock), `src/host/` (PowerShell interop), `src/transports/`, `src/render/`.

Install: `install/install.cmd` → `install.ps1`. Build: `scripts/bundle.mjs` → ~350 KB.

### Frontend

`/admin/printing` (`app/(dashboard)/admin/printing/page.tsx` +
`components/admin/printing/printing-view.tsx`), gated `settings.manage`. Two device rows,
attention-first queue, the `unconfirmed` question, test-print triggers with a product picker.

### The six kinds

| Kind             | Printer | Notes                                                                                                  |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `sale_receipt`   | receipt | **No VAT anywhere** — not registered. No card-transaction block; the card machine prints its own slip. |
| `refund_receipt` | receipt | Headed **REFUND**. Two references. Does not print the internal reason or the window override.          |
| `payout_receipt` | receipt | `BUY-` series, money out. Amount arrives negative; `Math.abs` happens once, beside the words.          |
| `job_label`      | label   | Reference largest, Code 39 barcode bottom.                                                             |
| `shelf_label`    | label   | Priced from `resolve_sale_unit_price`, not `products.price`.                                           |
| `test_print`     | either  | Five variants — §6.                                                                                    |

**Customers never see stock counts, cost or margin**, and the protection is upstream:
`buildShelfLabel` selects `id, name, sub, barcode` only. `cost_price` and `stock_qty` are never
loaded, so no renderer can leak them by forgetting.

### Permissions per kind

`sale_receipt`/`refund_receipt` → `pos.operate` · `payout_receipt` → `tradein.manage` ·
`job_label` → `jobs.manage` · `shelf_label` → `inventory.manage` · `test_print` →
`settings.manage`.

`shelf_label` is `inventory.manage` and not `labels.manage` deliberately: the designer page is
for _building_ templates; printing a shelf label happens from inventory, by whoever is pricing
stock. A single `pos.operate` on the endpoint meant stock-room staff could not print one.

---

## 4. The three hardware assumptions

Each is isolated so being wrong is cheap. **If changing one means editing more than one file,
something has been built wrong.**

| #   | Assumption                                            | If wrong                                                                                                                                                         |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The POS80GXa is **USB**, visible as a Windows printer | **Zero files change.** `tcp.ts` is already written and already selectable — set `receipt.transport` to `"tcp"` plus a host in `printer_config`. A settings edit. |
| 2   | The label roll is **62mm continuous**                 | A settings edit. Continuous is self-correcting: we choose the length, so a wrong guess is not a cropped label.                                                   |
| 3   | The **Brother driver may not be installed**           | A documented five-minute setup step.                                                                                                                             |

Transport selection lives in exactly one file: `apps/print-agent/src/transports/index.ts`.

---

## 5. UNVERIFIED — needs the device

**No printer has ever been connected.** This list closes on the shop visit.

1. **`£` (0x9C) on the POS80GXa.** cp437 carries the pound at 0x9C — verified against the
   _encoder_, not the printer. Whether this clone renders that byte as `£` is a property of the
   device. → Test 3
2. **Column count.** `42 columns` is still an assumption, and it drives barcode module width.
   **Paper width is CONFIRMED 80mm** — the shop's rolls are THM80, photographed. Test 1 now
   proves something narrower but still worth proving: that the printer's _configured_ width
   matches the paper actually loaded. → Test 1
3. **Cut placement, and whether `GS V 1` (partial cut) is honoured.** The gap between head and
   cutter is physical. The 2-line feed before the cut is conventional, not measured. → Test 2
4. **Whether the printer renders `GS k` Code 39 at all**, and whether the shop's Eyoyo EY-7130
   has Code 39 enabled — most scanners do, some ship locked to EAN/UPC. → Tests 4 and 5
5. **cp852 support on this clone.** If absent, accented names render as _wrong glyphs_ rather
   than `?`. Cosmetic either way; one settings edit to revert to `['cp437']`.
6. **Whether 2 lines of feed clears the tear bar.** → Test 2
7. **Roll width, and whether the Brother driver is installed on the till PC.** → Test 5
8. **Arabic on receipts** — bytes are valid, but shaping and RTL ordering are not verified and
   are probably wrong. **The label path IS verified for Arabic** (GDI+ draws glyphs), and the
   repair label is the surface where a customer's name actually matters.
9. **Nordic/Icelandic (`ø`, `Þ`) degrade to `?` on receipts** with the current cp437+cp852 pair.
   Known limitation, not a bug. cp850 would cover them — a settings edit once the printer's
   self-test page says which tables it carries.
10. **`MIN_NARROW_MM = 0.19`** in `barcode.ts` — the narrowest bar we will print. That is
    Tanoli's judgement, not a measured device property, and it reads like a spec.
11. **The installer has never run on a clean PC.** Only the Node-already-present path was
    exercised.
12. **Drive write-cache honesty.** The marker's durability assumes `FlushFileBuffers` is not
    lied to by firmware. Nothing in userspace closes that.
13. **Glyph rendering was verified on a dev PC's fonts.** The till PC needs the same Arial and
    fallback coverage — near-certain on standard Windows 10, unconfirmed on that machine.

---

## 6. The five test prints

Each proves exactly one thing that cannot be checked from an office, and **a failure must be
visible to someone who does not know what correct looks like.** "The right-hand marker is
missing" is reportable by a shop employee; "the codepage is wrong" is not.

| #   | Variant    | Proves                                            | Failure looks like                                                                        |
| --- | ---------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | `width`    | Paper is really 80mm / 42 cols                    | Full-width bars and a `\|<---80mm>\|` marker **wrap onto a second short line**            |
| 2   | `cut`      | Cutter fires, in the right place                  | Correct = two separate slips. One long strip = never fired. Sliced text = wrong position  |
| 3   | `encoding` | `£` renders; code tables switch                   | Includes a **labelled control line** that is _expected_ to fail                           |
| 4   | `barcode`  | A printed barcode scans back as the right product | Staff scan it with the **Eyoyo EY-7130**. Right product = pass. Machine-checked           |
| 5   | `label`    | Roll width, feed alignment, drawn barcode         | Missing corner tick = misfeed. Box missing its right edge = roll narrower than configured |

Tests 4 and 5 share the same product deliberately, so both printers are proven against one
known-good answer — if one scans and the other doesn't, the difference is the printer.

**The control in test 3 matters.** Without it, a test where nothing prints its accents looks
identical to one where everything does. The slip says in plain words which characters are
_expected_ to come out as `?`, and to report it if they don't.

`apps/print-agent/PRINTER-CHECK.md` is the plain-language sheet for whoever is in the shop.

---

## 7. Running and testing it locally

**No hardware needed.** The fake transport is a first-class target, not a test hack.

```bash
pnpm install
# API
cd apps/api && npx tsx src/server.ts
# Agent, printing to files instead of paper
cd apps/print-agent
FONOLOGY_FORCE_FAKE=1 npx tsx src/index.ts
```

`FONOLOGY_FORCE_FAKE=1` overrides settings entirely and **logs loudly at warn level every
time** — an agent silently printing to a folder in a live shop would be the worst possible
failure. Do not quieten that.

Output lands in the state directory as `.bin` (raw) plus a decoded `.txt`, and a real PNG for
labels rendered through the same GDI+ path the Brother driver would receive.

**pgTAP** runs against the local Docker stack only, never a hosted project:

```bash
npx supabase start -x realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor,mailpit
npx supabase test db
```

The `-x` list is required on the machine this was built on — those containers fail health checks
and roll the whole start back, and pgTAP only needs Postgres. **`supabase db reset` has hung
twice**; applying migration files directly with `psql` is the reliable path.

Current: **395 tests across 26 files, all passing.**

---

## 8. Things that will bite you

1. **Do not reorder the worker's steps.** The ordering _is_ the safety argument (§2).
2. **Never invert a `reachedPrinter` default.** Unknown must always mean `true`.
3. **Do not "promote" the Scheduled Task into a Windows service.** It looks like the more
   professional choice and **it would not print at all.** A LocalSystem service runs in Session
   0, which is isolated from user sessions, and services there have well-documented trouble
   seeing printers installed in a user session. Both printers go through the Windows print
   subsystem, so the service is the wrong container. The task deliberately uses
   `InteractiveToken` for the same reason — it must run in the logged-on session where the
   printers exist.

   **No auto-login is needed** — client-confirmed: _"we log out every night once we leave and
   when we come back in we log back in, an on and off system."_ That is better than the design
   assumed. The task's logon trigger fires when staff log in each morning, which is exactly the
   intended behaviour, and the agent is simply offline overnight.

   The logon trigger repeats every 10 minutes forever, which is a free watchdog: a repeat launch
   while healthy exits in milliseconds, because the agent refuses to start twice.

   **The nightly logoff was traced and holds:**

   - The single-instance lock is a bound socket, so the OS releases it on logoff however the
     process dies — the next morning's login binds cleanly.
   - Markers live in `%PROGRAMDATA%`, which is machine-wide, not per-user. A job that was
     mid-print when someone logged out keeps its marker, and `readOrphanedMarkers()` reports it
     as "may have printed" on the next start. Independently, `expire_print_leases()` moves that
     receipt to `unconfirmed` server-side while the agent is off. Both halves cover it.
   - Health reads `asleep`, not `down`, outside opening hours — verified against the shop's real
     hours across eight cases including Saturday's 17:00 close, Sunday, before the 09:30 open,
     and a winter GMT date. No 3am false alarms.

4. **The single-instance lock is a bound `127.0.0.1` port, not a lockfile** — deliberately. A
   lockfile goes stale when the PC is killed at the wall, and the agent would then refuse to
   start forever, turning a reboot into a dead till. The OS releases a port however the process
   dies. Don't "fix" it into a lockfile.
5. **Do not remove the `newline()` after `initialize()`** in `receipt.ts`. It looks redundant.
   The encoder hoists alignment padding in front of the `ESC @` bytes without it, and betting an
   unverified clone discards it is not a bet worth taking.
6. **Do not try to indent receipt lines with spaces** — the encoder strips leading whitespace on
   both `.line()` and `.text()`. Every layout is flush left.
7. **Encoder codepage names are `windows1250`, not `cp1250`.** The latter throws.
8. **An unsupported barcode symbology does not throw** — it emits zero bytes and one console
   line. `assertBarcodeSupported()` turns that into a loud startup failure. Keep it.
9. **`print_jobs.payload` carries customer PII** (name and phone on a bench ticket).
   `print_job_retention_days` defaults to 7 for that reason. Do not lengthen it casually.
10. **The heartbeat is the remote-management surface.** It re-reads `printer_config` and `/shop`
    every 30s and rebuilds transports on change — so a printer name, roll size, codepage or the
    shop's phone number can be corrected remotely and takes effect within a minute, with nobody
    touching the shop PC. Don't break that.
11. **`\uXXXX` escapes typed into a file get normalised to the glyph** before reaching disk in
    this toolchain. Generate them programmatically if you edit `sanitise.ts`.

---

# 9. Pre-deployment checklist

**Nothing below is optional. This is what stands between the current state and a shop that can
trade on it.**

## ⚠️ Do these in order. Deployment comes FIRST.

The agent in Glasgow reaches the API **over the internet**. Until the API is deployed at a
public address, there is nothing for it to reach — so the shop visit cannot happen first, and no
test print can be run. The order is:

```
9.1  Deploy the API and database          ← nothing works before this
9.2  Scheduled jobs
9.3  Install the agent on the till PC     ← needs the URL from 9.1
9.4  The shop visit and the test prints   ← needs 9.3 running
9.5+ Everything else, any order
```

**If you want to test printing before paying for a VPS**, you can expose a locally-running API
with a tunnel:

```bash
cloudflared tunnel --url http://localhost:4000
```

That gives a temporary public URL to point the agent at. It only lives while your machine is on
and that command is running, and the URL changes each time — fine for one test session, not a
way to run a shop.

### 9.1 Production deployment — do this first

- [ ] Hetzner + Coolify provisioned
- [ ] **Full migration chain 0001→0035 applied to the production Supabase project.** Production
      has never had any of it. Do not skip ahead
- [ ] Production secrets set (service-role key, Brevo, Stripe)
- [ ] **Production Google OAuth redirect URI.** This is per-project and must be redone — dev's
      does not carry over, and sign-in will fail silently in a way that looks like a code bug
- [ ] Production storage bucket policies applied
- [ ] `NEXT_PUBLIC_API_BASE_URL` pointing at the production API
- [ ] **Confirm the API answers from the public internet**, not just from your own machine — the
      shop PC has to reach it

### 9.2 Scheduled jobs — currently scripts with no scheduler

**Both are written and neither runs on its own.** Confirm each is wired to cron or a Coolify
scheduled task and has actually fired once.

- [ ] `apps/api/scripts/purge-documents.ts` — ID documents, 30 days. **This is a
      data-protection commitment already made to customers in page copy.** A promise nothing
      keeps is worse than no promise
- [ ] `apps/api/scripts/purge-print-jobs.ts` — print payloads, 7 days, contains customer PII

### 9.3 The agent on the till PC — needs 9.1 done

Most of this can be done **remotely**. Put AnyDesk or TeamViewer on the till PC once, and you can
install and configure everything yourself from anywhere. A person in the shop is only needed for
cables and paper.

- [ ] **Node 20+ installed** — the installer stops with instructions otherwise. The bundle is
      ~350 KB and deliberately does not embed Node (that would be 80–110 MB)
- [ ] Run `install.cmd`. **No admin rights needed** — it installs under `%LOCALAPPDATA%`
- [ ] **SmartScreen will warn.** There is no code signing at all. Whoever installs it must be
      told this in advance, or they will stop and assume it is malware
- [ ] Scheduled Task registered and starts at logon. **No auto-login needed** — staff log in
      each morning and the task fires then (client-confirmed on/off routine)
- [ ] Agent token issued from `/admin/printing` and pasted in — shown once, never again
- [ ] Confirm `/admin/printing` shows the agent `ok` and both devices reporting

### 9.4 The shop visit — closes most of the unknowns

**You do not have to be there.** The agent pulls work from the API, so the test prints are
triggered from `/admin/printing` anywhere in the world and the paper comes out in Glasgow. Send
whoever is in the shop `apps/print-agent/PRINTER-CHECK.md` — it is written for them, in plain
language, and tells them what to photograph and what to report.

They are needed for four things: plugging the printers in, loading paper and the label roll,
photographing the output, and scanning the printed barcode.

- [ ] Both printers plugged in and powered; POS80GXa confirmed as USB-or-LAN (assumption 1)
- [ ] Brother QL-600 driver installed on the till PC
- [ ] DK roll part number read off the roll and recorded (assumption 2)
- [ ] **Run all five test prints** from `/admin/printing`
- [ ] **Photograph every slip** and send them back
- [ ] **Scan the printed barcode with the Eyoyo EY-7130** — this is the strongest single test and
      the only machine-checked one
- [ ] Print the printer's own **self-test page** — it lists which code tables it carries, which
      settles cp852 and the Nordic question
- [ ] Record the POS80GXa's IP and whether it is DHCP or static. **If DHCP, set a reservation** —
      otherwise it moves one morning and printing stops silently

Resolves UNVERIFIED items 1–7, 9, 13.

### 9.5 Stripe — online checkout is not built

- [ ] Client provides the Stripe account. **Blocked on them, not on us**
- [ ] **Replace the `requireStaff` gate on the stand-in webhook** in
      `apps/api/src/routes/orders.routes.ts` with real **signature verification** against
      Stripe's webhook secret. Staff auth on a webhook is a placeholder, not security, and the
      comment there says so
- [ ] **Clearpay is a Stripe dashboard toggle**, not a separate integration — decide yes/no with
      the client, then enable it. No code work is expected
- [ ] `payment_provider_events` was **deliberately deferred**. Before building it, answer: what
      provider payloads get stored, for how long, and do they contain cardholder PII? That is a
      retention and data-protection question, not a schema question

### 9.6 The diverging browser receipt

- [ ] **Retire `apps/web/src/components/pos/receipt.tsx` once the agent is live.**

  It still exists and is still wired to the one `printService.printReceipt()` call site in
  `pos-view.tsx`. It does **not** show the barcode or the card slip reference. **Two receipts
  for one sale that differ is precisely the failure class this project keeps paying for** — it
  is the same shape as the returns-window bug, which cost three separate fixes.

### 9.7 Generated Supabase types — do this before handover

- [ ] `bash
npx supabase gen types typescript --local > apps/api/src/types/database.ts
`
      then thread the type through `supabaseAdmin`.

  `supabaseAdmin` is currently constructed **without** generated types, so every `.select()`
  returns `any` and it spreads. That is the **single root cause of 461 suppressed lint findings**
  (`no-unsafe-assignment` and friends, documented in `apps/api/.eslintrc.cjs`) and of the
  Zod-schema-mismatch bug class that has bitten this project repeatedly. Most of the 461
  disappear on their own; the rest become real findings worth reading.

### 9.8 Wire the till — nothing calls the queue yet

- [ ] **No screen enqueues a print job.** The adapter method, hook and types all exist; only the
      buttons are missing. Sale completion, the jobs board and inventory each need one
- [ ] Manually click through the `unconfirmed` resolve buttons in a browser — the path was
      exercised at the HTTP level but a modal blocked the final click-through

### 9.9 Open client questions

- [ ] **Payout receipt legal wording.** Does a trade-in payout receipt need an ownership /
      right-to-sell declaration? Second-hand device purchase in the UK carries real obligations.
      Wording was deliberately **not** drafted on a guess
- [ ] **Social media URLs** — `SOCIALS` in `lib/site.ts` still points every link at `#`
- [ ] **The legal footer line.** The footer says "© 2026 Fonology Ltd", but the client confirmed
      the trading name is **Fonology**, not "Zakaso Limited T/A Fonology". Neither of those is
      necessarily the right registered entity for a copyright line — ask
- [ ] **The receipt photograph.** `sale_receipt` is modelled on the project's own browser receipt
      plus the spec. `CONTENT-TODO.md` still says the format comes from the client
- [ ] **Clearpay** — see §9.3

### 9.10 Smaller, but real

- [ ] `codepageCandidates` has **no migration** — it exists only as a Zod default, so it is not
      in `printer_config` in the database and not discoverable in a settings UI. If someone
      overwrites that JSON blob the key vanishes. Worth adding explicitly
- [ ] The **label designer has no backend**. `listLabelTemplates` / `saveLabelTemplate` /
      `deleteLabelTemplate` are all `notImplemented()`, no route touches `label_templates`, and
      `linked_product_id` — added in 0009 specifically to link a template to a real product
      barcode — is referenced nowhere. The designer works against the mock adapter only
- [ ] Dev leftovers: one `print_agents` row (`"Dev till PC (fake printers)"`) and 7 `print_jobs`.
      Harmless, self-purging, delete if you want dev clean
- [ ] `HANDOVER-FRONTEND.md` §7 links to **`TEST-LOGINS.md`, which is not in the repo** — it was
      only ever pasted into chat. Either commit it (without real passwords) or fix the link
- [ ] `PART-B-HANDOFF.md` is left uncommitted in the working tree — session scaffolding,
      superseded by this document. Delete it

---

## 10. What was checked, and what was not

| Check            | Result                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pgTAP            | **PASS** — 395 tests, 26 files, including `025` (the asymmetry) and `026` (refund references, first ever run)                                                   |
| Typecheck        | **PASS** — 3/3 packages                                                                                                                                         |
| Lint             | **PASS** — 3/3 packages                                                                                                                                         |
| Schema audit     | **HARD 0 · SILENT 1 · EMPTY 1 · OK 29** — the one SILENT is pre-existing and unrelated (`sellRequestPageSchema` declares an optional field the API never sends) |
| Agent end-to-end | **PASS** against the fake transport — 7 jobs claimed, rendered, acked; single-instance lock proven incidentally                                                 |
| Real printer     | **NEVER RUN**                                                                                                                                                   |

Byte-level checks that were actually read out of the fake transport rather than assumed:
`0x9C` for `£`; `GS k 4` Code 39, NUL-terminated; `GS V 1` partial cut; `ESC t 18` switching to
cp852 mid-line so a pound sign and a Polish name coexist; a `14:05Z` refund printing `15:05`
(BST correct).

**Two claims in the incoming briefs did not match the repo**, and are corrected here:

- **Order tracking IS wired.** `confirmation-view.tsx` links to
  `/track?ref=…&email=…` and `track-request.tsx` reads both params. It was listed as unwired; it
  is not.
- The migrations README was **not** 19 versions stale — it was current to 0032 and has since
  been brought to 0035.
