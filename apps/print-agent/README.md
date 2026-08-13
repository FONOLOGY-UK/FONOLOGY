# @fonology/print-agent

The bit of Fonology that runs **inside the shop**. It pulls print jobs from the API and drives the
two physical printers behind the counter in Thornliebank.

- **Brother QL-600** label printer — USB only, 300dpi, DK rolls
- **eposnow POS80GXa** thermal receipt printer — 80mm, ESC/POS

---

## Why this exists at all

Two independent reasons, and a design solving only one of them would fail in the shop:

1. **A browser cannot open a raw socket.** JavaScript in a tab is limited to HTTP/HTTPS and
   WebSockets. It cannot reach a printer on port 9100 and cannot write to a USB device. True
   regardless of cable type — this, not USB-vs-network, is where the "local agent" pattern comes
   from.
2. **The backend is not in the shop.** `apps/api` runs on a Hetzner VPS in Germany. The printers sit
   on a Glasgow shop's private LAN behind a consumer router. Germany cannot reach them, and that
   printer must never be exposed to the internet.

WebUSB and Web Serial are deliberately **rejected**: Windows binds the QL-600 to its own driver so
WebUSB generally cannot claim it; both need a user gesture and a device re-pick every session, which
is unusable at a counter; they are Chrome-only; and critically they solve none of the durability
problem, because a closed tab has no queue.

**The agent pulls; the server never pushes.** An outbound poll traverses any consumer router with
zero configuration. Push would need port forwarding or a tunnel — fragile, and a security liability
aimed at a printer.

---

## How it fits together

```
till (browser)                apps/api (Hetzner, Germany)          this agent (shop PC)
   |                                    |                                   |
   |-- POST /print/jobs --------------->|                                   |
   |   {kind, entityId, dedupeKey}      |  builds the frozen payload         |
   |                                    |  from the entity, server-side      |
   |                                    |<-- GET /print/jobs/next -----------|  long-poll, ~25s
   |                                    |--- job ------------------------->  |
   |                                    |                                   |-- marker to disk (fsync)
   |                                    |                                   |-- bytes to printer
   |                                    |<-- POST /print/jobs/:id/ack ------ |
   |                                    |                                   |-- marker cleared
```

The queue itself (tables, state machine, lease/expiry rules) is migration `0033`, and the endpoints
are `apps/api/src/routes/print.routes.ts`. Read those first — this agent is a client of that design,
not the owner of it.

---

## The safety property, in one paragraph

Exactly-once delivery is impossible across a network. What this system provides is **at-most-once**
plus an explicit `unconfirmed` state that asks a human the one question no algorithm can answer: did
the paper actually come out?

That hinges entirely on `reachedPrinter`, which the agent derives from an **on-disk marker** written
immediately before the first byte and cleared only after the server accepts the ack.

- **marker absent** → nothing was sent → safe to requeue automatically
- **marker present** → bytes may have gone → a receipt becomes `unconfirmed`, never auto-reprinted

A duplicate receipt in a customer's hand is what a fraudulent return looks like. A missing one is a
reprint. Every ambiguous case therefore resolves towards "assume it printed". See `src/marker.ts`,
which documents how this survives the plug being pulled.

Labels are treated differently on purpose — a duplicate label is an inch of wasted roll — and that
asymmetry lives in the database (`expire_print_leases`), not here.

---

## Running it locally

```bash
pnpm --filter @fonology/print-agent build
```

```bash
FONOLOGY_API_URL=http://localhost:4000 FONOLOGY_AGENT_TOKEN=<token> FONOLOGY_FORCE_FAKE=1 node apps/print-agent/dist/index.js
```

| Variable                   | Purpose                                                           |
| -------------------------- | ----------------------------------------------------------------- |
| `FONOLOGY_API_URL`         | API base URL. Overrides `agent.json`.                             |
| `FONOLOGY_AGENT_TOKEN`     | Agent token. Overrides `agent.json`. Never logged.                |
| `FONOLOGY_AGENT_DIR`       | Move all state somewhere else. How tests get a scratch directory. |
| `FONOLOGY_FORCE_FAKE`      | `1` sends everything to the fake printer. Logs loudly every time. |
| `FONOLOGY_AGENT_CONSOLE`   | `1` also writes the log to stdout.                                |
| `FONOLOGY_AGENT_LOG_LEVEL` | `debug` / `info` / `warn` / `error`.                              |

A token is issued at **Settings → Print agents** and shown exactly once.

### The fake printer

A **first-class target**, not a test hack — it is how this pipeline is exercised with no hardware and
how the real thing gets debugged later. It writes to `<state>/fake-printer/`:

- `*.bin` — the exact ESC/POS bytes
- `*.txt` — those bytes as readable text plus a hex dump
- `*.json` — the label display list
- `*.png` — the label rendered through the same GDI+ path the Brother driver receives

---

## Installing on the till PC

```
apps/print-agent/install/install.cmd     <- double-click this
apps/print-agent/install/uninstall.cmd
```

It asks two things (API address, which has a default, and the token) and then does everything else.
No administrator rights are required.

**A Scheduled Task at logon, not a Windows service.** A LocalSystem service runs in Session 0, which
is isolated from user sessions, and services there have well-documented trouble seeing printers
installed in a user session. Both printers in this design go through the Windows print subsystem, so
a service is the wrong container — it is the more "professional" choice and it would not print. The
PC is set to log in automatically; the security cost is negligible behind a counter, and the app
itself is PIN-locked.

The logon trigger **repeats every 10 minutes forever**. That is a watchdog, not a workaround: the
agent already refuses to start twice, so a repeat launch while it is healthy exits in milliseconds,
and a repeat launch after a crash brings it back within ten minutes with nobody in the shop doing
anything.

Prerequisite: **Node.js 20+** must be on the PC, or `node.exe` copied next to the installer. The
installer checks and says exactly what to do.

---

## Configuration lives in the database, not here

Everything about the printers comes from `shop_settings.printer_config` via `GET /print/config`, and
is re-read on every heartbeat — so a change takes effect within a minute with nobody touching the
shop PC. Only two things are local (`agent.json`): **where the API is** and **what token to use**.

That split is what makes the hardware assumptions cheap to be wrong about.

---

## The three assumptions

| #   | Assumption                                                                              | If it is wrong                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | POS80GXa is USB, installed as a Windows printer; we send raw ESC/POS to the print queue | **No code change.** Set `receipt.transport` to `"tcp"` and fill in `receipt.host`. The TCP transport is already built and already selectable.                                                                                                                      |
| 2   | 62mm **continuous** roll (DK-22205)                                                     | Change `label.rollWidthMm` / `labelLengthMm`. Continuous is self-correcting — we choose the length, so a wrong guess wastes roll rather than cropping a label. A **die-cut** roll is deliberately not implemented on a guess; `rollType` already carries the flag. |
| 3   | The Brother driver may not be installed                                                 | A documented setup step and a free download.                                                                                                                                                                                                                       |

If changing assumption 1 ever needs a code change, it is confined to `src/transports/index.ts`.

---

## UNVERIFIED — needs the physical devices

Nothing below can be settled without the hardware. Do not let a green test suite suggest otherwise.

- **The codepage.** `cp437` is the ESC/POS default and does carry `£` at `0x9C` (verified against the
  encoder). Whether **this clone** renders `0x9C` as a pound sign is a property of the device. The
  test print includes a `£` line specifically so it can be photographed.
- **`rule()` uses `0xC4`**, the cp437 box-drawing character. If the codepage changes, the horizontal
  rules change meaning too.
- **Cut behaviour.** `GS V 1` (partial) is emitted by the encoder. Clones diverge here more than
  anywhere else. `cut` is configurable for that reason.
- **Column count.** 42 assumed for 80mm. The test print includes a full-width ruler; if it wraps, the
  real value is different.
- **Feed before cut.** Two lines is conventional. The gap between print head and cutter is physical.
- **Label origin and page size.** Whether the Brother driver honours a custom `PaperSize` and where it
  places the origin is driver behaviour. The label may need an offset.
- **Print-head/roll alignment**, and whether 300dpi is what the driver actually exposes.
- **Marker durability under a real power cut.** `fsync` maps to `FlushFileBuffers`, which asks the
  drive to commit its cache. A drive with a volatile cache and dishonest firmware can still lie.
  Nothing in userspace can close that gap.
- **Non-Latin customer names.** Text is NFC-normalised and smart punctuation is folded to ASCII
  (`src/render/sanitise.ts`), which fixes the common cases. Genuinely non-Latin scripts still print as
  `?`. The real fix is an image-based receipt — a much larger change, and not one to make on a guess
  about a printer nobody has plugged in yet.

---

## Scope note for Part C

The **layouts** in `src/render/receipt.ts` and `src/render/label.ts` are **provisional**. They render
the frozen payload faithfully so the pipeline can be exercised and photographed, but what sits where,
the warranty wording, the returns policy, the footer, the VAT position and the bench-ticket **barcode**
are Part C's to decide. The `rect` draw op exists precisely so Code128 bars can be added without the
renderer or the PowerShell host changing.

Worth keeping when the layouts are rewritten:

- the `initialize().newline()` sequence (a verified library ordering quirk — see the comment)
- `sanitiseForPrinter()` on every string that reaches the printer
- `formatPence()` — money stays integer pence until the moment it is rendered

There is **no cash drawer** — confirmed with the shop. `kickDrawer()` in
`apps/web/src/lib/print/print-service.ts` is a documented no-op. Do not write drawer-kick codes.

---

## Rules this code follows

- **No ESC/POS byte sequences written by hand.** Every control code comes from
  `@point-of-sale/receipt-printer-encoder` (MIT). If you find yourself typing `\x1b`, stop.
- **No Brother raster protocol, anywhere.** We draw with GDI+ and the installed Brother driver
  rasterises. Brother owns the part that cannot be verified without the device.
- **Money is integer pence** until `formatPence()`.
- **The token and customer PII never reach a log.** See `src/logger.ts`.
