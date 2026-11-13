# 12. Print agent and the shop hardware

Part of the Fonology manual. The index and the everyday rules are in [`CLAUDE.md`](../CLAUDE.md); "section N" means the file numbered N in this folder, or that section of `CLAUDE.md`.

The agent runs on the till PC as a **Windows Scheduled Task at logon** (not a service: a LocalSystem service runs in
an isolated session and cannot see printers; the logon trigger repeats every 10 minutes as a watchdog). It long-polls
`GET /print/jobs/next` and never accepts inbound connections. Install: `apps/print-agent/install/install.cmd`
(needs Node 20+; asks for the API URL and a token created in Settings → Print agents, shown once). `dist/` is not in
git: run `pnpm --filter @fonology/print-agent build` and copy `dist` and `install` side by side to the till PC. Run the
installer **signed into the Windows account staff use every day** — the task, the program folder and the token file
belong to whoever ran it, and the shop logs out nightly. The **newest token is the one that prints**; creating one
demotes the others in that shop (switch the old ones off). The agent refuses to print until
`shops.printer_config.receipt|label.windowsPrinterName` hold the exact Windows printer names (`Get-Printer` on the
till PC); no screen sets them yet, so that is an SQL update.

Delivery is **at-most-once**: an on-disk marker is written before the first byte and cleared after the ack. Marker
absent → safe to requeue; marker present → a receipt becomes `unconfirmed` and is never auto-reprinted (a duplicate
receipt looks like return fraud; a duplicate label only wastes an inch of roll). A job Windows holds (printer out of
paper or off) is taken back out of the Windows queue when the agent gives up on it, so it cannot print by surprise
after a Reprint; the "Did this come out?" row says whether that worked. Printer settings live in
`shops.printer_config`; only the API URL and token are local (`agent.json`). Cards: two machines (Shift4, Dojo) keyed
by hand — the till has "Send to machine" / "Card approved" / "Declined"; reconcile day-close card totals against each
machine's settlement report. There is no cash drawer.

**Unverified until someone tests with the real printers** (Brother QL-600 label, eposnow POS80GXa receipt, 80mm):
the `£` codepage (cp437 `0x9C`), cutter behaviour, column count (42 assumed), feed-before-cut, label origin and roll
size (62mm continuous assumed), long barcode width (Code 39 at 17 characters — the barcode test print uses a product's
shorter barcode, so also print a real sale receipt and scan its reference), and cp852 on this clone. Names: labels are
drawn by Windows and print every script; receipts print European accents by switching to cp852, while Chinese,
Arabic and Urdu print as `?` on receipts only. Use the admin **Printers** page test prints and photograph them. Use the 80mm THM80 roll in the receipt printer — the
57mm card-machine roll fits but prints squashed.
