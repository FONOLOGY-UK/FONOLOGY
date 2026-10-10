-- 0036 — Make `codepageCandidates` a real, visible setting.
--
-- THE PROBLEM
-- 0033 seeded `printer_config.receipt` with a single `codepage` of 'cp437'.
-- The agent later gained the ability to switch ESC/POS code tables MID-LINE,
-- driven by a `codepageCandidates` array — but that array only ever existed as
-- a Zod default in apps/print-agent/src/printerConfig.ts. It appears nowhere in
-- the database.
--
-- WHY THAT IS A BUG AND NOT A TIDY-UP
-- `GET /print/config` returns this jsonb verbatim. Anyone editing printer
-- settings edits the whole blob. Because the key is absent from the stored
-- JSON, there is nothing on screen to preserve, so a well-meaning edit silently
-- drops a setting nobody knew was there — and receipts quietly lose Polish and
-- Czech characters, degrading to '?', with no error anywhere. Exactly the class
-- of failure this project keeps paying for: correct-looking output that is
-- subtly wrong.
--
-- WHY BOTH KEYS STAY
-- `codepage` is the single table used when only one candidate is offered;
-- `codepageCandidates` is the list the encoder switches between. Removing the
-- singular key would be a destructive change to a column the agent parses at
-- startup, and 0036 is additive only.
--
-- WHAT THE VALUES MEAN — measured against the encoder, not recalled:
--   cp437  carries the pound sign at 0x9C. Loses 2 characters from a Polish
--          name, which stays readable.
--   cp852  fixes Polish and Czech completely — and BREAKS the pound sign,
--          which is why it can never be the only table.
-- Offering both lets the encoder emit `ESC t 0` for the pound and `ESC t 18`
-- for the accented letters within one line, which was verified end to end:
-- "£12.34 Łukasz Woźniak" encodes with zero substitutions.
--
-- cp852 support on this particular POS80GXa clone is UNVERIFIED — it is table
-- 18 in the standard Epson set, but whether this device implements it is a
-- property of the hardware. If it does not, an accented name prints a wrong
-- glyph rather than '?'. Cosmetic either way, and narrowing the array back to
-- ["cp437"] is a settings edit. Decide after reading the printer's self-test
-- page, not before.
--
-- Applied to the DEV project only, per the standing hard rule.

-- jsonb_set with create_if_missing = true, so this is a no-op on any row that
-- somehow already carries the key rather than overwriting a deliberate choice.
update public.shop_settings
   set printer_config = jsonb_set(
         printer_config,
         '{receipt,codepageCandidates}',
         '["cp437", "cp852"]'::jsonb,
         true
       )
 where not (printer_config -> 'receipt' ? 'codepageCandidates');

-- Keep the DEFAULT in step, so a freshly-seeded database and an upgraded one
-- describe the same printer. Without this, production would be created without
-- the key and the bug would come straight back on the environment that matters.
alter table public.shop_settings
  alter column printer_config set default '{
    "receipt": {
      "transport": "windows",
      "windowsPrinterName": null,
      "host": null,
      "port": 9100,
      "paperWidthMm": 80,
      "cut": "partial",
      "codepage": "cp437",
      "codepageCandidates": ["cp437", "cp852"]
    },
    "label": {
      "transport": "windows",
      "windowsPrinterName": null,
      "rollType": "continuous",
      "rollWidthMm": 62,
      "labelLengthMm": 40
    }
  }'::jsonb;

comment on column public.shop_settings.printer_config is
  'Per-target printer configuration read by the agent. Holds the researched hardware assumptions (transport, roll size, ESC/POS code tables) so that being wrong about any of them is a settings edit, not a code change. receipt.transport is CONFIRMED "windows" — the POS80GXa is USB-cabled to the till PC. receipt.codepageCandidates lets the encoder switch code tables mid-line so a pound sign and an accented name can coexist; cp852 support on this clone is UNVERIFIED until the encoding test print is photographed. label.rollWidthMm remains UNVERIFIED — no photograph of the Brother DK roll exists yet.';
