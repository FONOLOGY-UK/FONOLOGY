-- 001 — Structure
-- Everything here is proved by querying information_schema / pg_catalog, not
-- by reading the migrations — so a future migration that adds a bad column
-- fails this file automatically, without anyone remembering to check by eye.
--
-- Two deliberate scope decisions, both explained where they bite:
--   1. The money-domain check only looks at BASE TABLEs, not views. 0010's
--      reporting views cast pence to plain integer on purpose (UNION ALL
--      across branches needs matching types, and SUM() always widens to
--      bigint regardless of domain) — that's a stored-vs-derived distinction,
--      not a rule violation. Table columns are the actual data; the views are
--      how it's presented.
--   2. The "no VAT" check uses a word-boundary regex, not a bare substring
--      match. A plain %vat% would flag every comment containing the word
--      "private" — this schema uses that word constantly (private buckets,
--      private documents) and none of it is about tax.

begin;
set local search_path to public, tap, extensions;
select plan(12);

-- ---------------------------------------------------------------------------
-- 1. Every money column uses the pence domain
-- ---------------------------------------------------------------------------

-- devices.price_multiplier is the one legitimate non-money numeric column in
-- the whole schema (a ratio, not currency — see 0006's own comment on it).
-- pence is integer-only by design, so a fractional multiplier could never be
-- represented in it anyway; excluding it here is recognising that, not
-- weakening the check.
select is_empty(
  $$
  select table_name || '.' || column_name || ' is ' || data_type
  from information_schema.columns
  where table_schema = 'public'
    and data_type in ('numeric', 'real', 'double precision')
    and not (table_name = 'devices' and column_name = 'price_multiplier')
  $$,
  'no numeric/real/double precision columns anywhere in public, except the one documented ratio column'
);

select is_empty(
  $$
  select table_name || '.' || column_name
  from information_schema.columns
  where table_schema = 'public'
    and udt_name = 'money'
  $$,
  'no columns use the native Postgres money type'
);

-- Money-shaped names, base tables only (see header). One documented
-- exception: devices.price_multiplier is a scalar ratio, not currency — it
-- matches %price% by coincidence of English, not because it holds money.
select is_empty(
  $$
  select c.table_name || '.' || c.column_name
        || ' (domain: ' || coalesce(c.domain_name, 'none') || ')'
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public'
    and t.table_type = 'BASE TABLE'
    and (
      c.column_name ilike '%price%' or c.column_name ilike '%amount%'
      or c.column_name ilike '%total%' or c.column_name ilike '%cost%'
      or c.column_name ilike '%fee%'
    )
    and coalesce(c.domain_name, '') <> 'pence'
    -- Documented false positives from the naming heuristic: these three
    -- contain "cost" as a substring of a longer word (below_cost, prompts_
    -- for_reason) but are a boolean flag and free text, never currency.
    and not (c.table_name = 'devices' and c.column_name = 'price_multiplier')
    and not (c.table_name = 'sales' and c.column_name in ('below_cost', 'below_cost_reason'))
    and not (c.table_name = 'shop_settings' and c.column_name = 'below_cost_prompts_for_reason')
  $$,
  'every money-shaped column name on a base table uses the pence domain (documented non-money exceptions aside)'
);

-- ---------------------------------------------------------------------------
-- 2. Every timestamp is timestamptz
-- ---------------------------------------------------------------------------

select is_empty(
  $$
  select table_name || '.' || column_name
  from information_schema.columns
  where table_schema = 'public'
    and data_type = 'timestamp without time zone'
  $$,
  'no bare timestamp columns anywhere in public (time-of-day columns like next_day_cutoff_time are a different type and are not caught by this)'
);

-- ---------------------------------------------------------------------------
-- 3. Row level security is enabled on every table
-- ---------------------------------------------------------------------------

select is_empty(
  $$
  select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity
  $$,
  'row level security is enabled on every ordinary table in public'
);

-- ---------------------------------------------------------------------------
-- 4. Every foreign key has an index on its own (referencing) side
-- ---------------------------------------------------------------------------
-- Checked as: does the table carry an index whose FIRST key column is the
-- FK's own first column. Every foreign key in this schema is single-column,
-- so "first column" is "the column" — this does not attempt to handle
-- composite foreign keys, because there aren't any to handle.

select is_empty(
  $$
  select cl.relname || '.' || a.attname as unindexed_fk_column
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  join pg_namespace ns on ns.oid = cl.relnamespace
  join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
  where con.contype = 'f'
    and ns.nspname = 'public'
    and not exists (
      select 1 from pg_index idx
      where idx.indrelid = con.conrelid
        and idx.indkey[0] = a.attnum
    )
  $$,
  'every foreign key column has a covering index on its own table'
);

-- ---------------------------------------------------------------------------
-- 5. Every table with updated_at has set_updated_at() attached
-- ---------------------------------------------------------------------------

select is_empty(
  $$
  select col.table_name
  from information_schema.columns col
  join pg_class c on c.relname = col.table_name and c.relnamespace = 'public'::regnamespace
  where col.table_schema = 'public'
    and col.column_name = 'updated_at'
    and not exists (
      select 1 from pg_trigger t
      where t.tgrelid = c.oid
        and t.tgfoid = 'public.set_updated_at'::regproc
    )
  $$,
  'every table with an updated_at column has the set_updated_at trigger attached'
);

-- ---------------------------------------------------------------------------
-- 6. The money ledger is a view, not a duplicated table
-- ---------------------------------------------------------------------------

select ok(
  (select c.relkind from pg_class c
   where c.relname = 'transactions' and c.relnamespace = 'public'::regnamespace) = 'v',
  'transactions is a view'
);

select ok(
  not exists (
    select 1 from pg_class c
    where c.relname = 'transactions' and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  ),
  'transactions is not also (or instead) a table'
);

-- ---------------------------------------------------------------------------
-- 7. No VAT anywhere
-- ---------------------------------------------------------------------------
-- Word-boundary match (\mvat\M), not a bare substring — see header comment.

select is_empty(
  $$
  select table_name || '.' || column_name
  from information_schema.columns
  where table_schema = 'public' and column_name ~* '\mvat\M'
  $$,
  'no column named vat anywhere in public'
);

select is_empty(
  $$
  select conname from pg_constraint con
  join pg_namespace ns on ns.oid = con.connamespace
  where ns.nspname = 'public' and con.conname ~* '\mvat\M'
  $$,
  'no constraint named vat anywhere in public'
);

select is_empty(
  $$
  -- pg_description covers comments on tables, columns, functions, types etc.
  -- via their (objoid, classoid, objsubid) triple; joining back to a human
  -- label is more machinery than this needs, so this just proves no comment
  -- text anywhere in the database mentions VAT as a word — good enough to
  -- catch a stray "-- VAT is 20%" a future migration might add.
  select d.description
  from pg_description d
  where d.description ~* '\mvat\M'
  $$,
  'no object comment anywhere mentions VAT as a word'
);
select * from finish();
rollback;
