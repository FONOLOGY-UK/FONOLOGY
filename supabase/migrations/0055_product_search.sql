-- 0055 — Fuzzy product search (Round 5 #9)
--
-- The storefront search was `ilike '%term%'` on name/sub only — pure
-- substring matching, so a plural ("names" for a product called "name"), a
-- different word form ("naming"), or a single mistyped letter all missed
-- entirely. This adds real fuzzy matching via pg_trgm (trigram similarity,
-- including word_similarity for a short search term against a longer
-- product name) and fuzzystrmatch (levenshtein edit distance, which
-- trigram alone handles poorly on very short words — two-letter
-- transpositions in a 4-letter word barely move a trigram similarity
-- score, since so few trigrams exist to compare).
--
-- Both extensions are common, first-party Postgres contrib modules
-- (already available on this Supabase project, confirmed via
-- pg_available_extensions before writing this).

create extension if not exists pg_trgm;
create extension if not exists fuzzystrmatch;

-- Trigram GIN indexes so `%` (similarity) and ILIKE both have something to
-- use instead of a sequential scan, once the catalog grows past the size
-- where that stops mattering. `sub` is nullable — trigram indexes simply
-- produce no entries for NULL rows, same as any other index.
create index products_name_trgm_idx on public.products using gin (name gin_trgm_ops);
create index products_sub_trgm_idx on public.products using gin (sub gin_trgm_ops);

-- Returns matching product ids ranked by relevance — callers join/filter
-- the ids against `products` themselves (is_active, in_store_only, category
-- etc. stay exactly where they already lived, in the API route) rather than
-- this function trying to reproduce every business rule about who gets to
-- see a product.
--
-- Ways a row can match, OR'd together:
--   1. plain substring (ILIKE)          — unchanged from before, cheapest
--   2. trigram similarity, thresholded  — catches plurals, close
--      directly on the numeric score      misspellings on a whole
--      (> 0.25), not the `%` operator     name/sub, at whatever
--                                          threshold this session picked —
--                                          not the `%` operator's own GUC
--                                          default (pg_trgm.similarity_
--                                          threshold), which this function
--                                          would otherwise silently inherit
--   3. word_similarity, same reasoning  — a short term against one word
--      (> 0.35, not the `<%` operator's   inside a longer name/sub, which
--      own GUC default of 0.6)            is what makes "naming" find
--                                          "NAME"
--   4. per-word levenshtein <= 2         — catches short-word typos that
--                                          (2) and (3) score too low to
--                                          clear their own thresholds on;
--                                          checked against each WORD in
--                                          name/sub individually (not the
--                                          whole multi-word string) — a
--                                          transposition inside "Widget"
--                                          should not have to out-edit
--                                          "E2E Shop Widget mtbxddlv" as
--                                          one 24-character comparison
--
-- levenshtein() isn't index-backed — at this catalog's size (tens of SKUs,
-- same reasoning the original ILIKE-only comment in products.routes.ts
-- gave) a handful of edit-distance calls per search, per word, is not worth
-- the extra infrastructure. Revisit if the catalog grows into the
-- thousands.
create or replace function public.search_products(p_term text)
returns table (id uuid, rank real)
language sql
stable
as $$
  select
    p.id,
    greatest(
      similarity(p.name, p_term),
      similarity(coalesce(p.sub, ''), p_term),
      word_similarity(p_term, p.name),
      word_similarity(p_term, coalesce(p.sub, ''))
    ) as rank
  from public.products p
  where
    length(trim(p_term)) > 0
    and (
      p.name ilike '%' || p_term || '%'
      or coalesce(p.sub, '') ilike '%' || p_term || '%'
      or similarity(p.name, p_term) > 0.25
      or similarity(coalesce(p.sub, ''), p_term) > 0.25
      or word_similarity(p_term, p.name) > 0.35
      or word_similarity(p_term, coalesce(p.sub, '')) > 0.35
      or exists (
        select 1 from unnest(regexp_split_to_array(lower(p.name), '\s+')) w
        where levenshtein(w, lower(p_term)) <= 2
      )
      or exists (
        select 1 from unnest(regexp_split_to_array(lower(coalesce(p.sub, '')), '\s+')) w
        where levenshtein(w, lower(p_term)) <= 2
      )
    )
  order by rank desc, p.name asc;
$$;

comment on function public.search_products is
  'Round 5 #9: fuzzy product search — trigram similarity/word_similarity plus levenshtein, OR''d with the original ILIKE substring match. Ranks by relevance; callers apply is_active/in_store_only/category filters themselves.';
