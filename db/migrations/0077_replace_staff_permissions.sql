-- 0077 - Atomic replacement of a staff member's permission set
-- ---------------------------------------------------------------------------
-- Independent audit finding HIGH-02.
--
-- PUT /admin/staff/:id/permissions replaced the set with a DELETE followed
-- by an INSERT. PostgREST runs each in its own transaction, so the pair is
-- not atomic and has two distinct bad outcomes:
--
--   * INSERT fails after DELETE committed -> the staff member is left with
--     ZERO permissions. On a shop floor that is someone locked out of the
--     till mid-shift, and it cannot be undone by retrying the same request
--     because the intended set is gone from the client's hands by then.
--
--   * DELETE fails and INSERT succeeds -> the old rows are still there and
--     the new ones are added on top: a UNION, not a replacement. The route
--     never checked the delete's error, so this failed silently and in the
--     privilege-RETAINING direction. Revoking a permission would appear to
--     work and not have. (The primary key (staff_id, permission) means the
--     insert only errors if the two sets actually overlap, so a genuine
--     revoke-only edit was the case most likely to slip through.)
--
-- One statement pair inside one function body = one transaction. Either the
-- new set is exactly what was asked for, or nothing changed at all.
--
-- p_permissions is text[] rather than permission[] so an unknown value
-- fails here, on the cast, with the offending value named -- rather than
-- inside PostgREST's argument marshalling, where the error would be far
-- less legible. The API validates the list against the same enum before it
-- ever gets here; this is the backstop, not the primary check.
--
-- APPLIED to the DEV project (ohkvwqqtppvnxbvvdsfr) on 2026-09-01 and verified
-- there: exact replacement, duplicate input tolerated, empty set clears,
-- unknown permission and unknown staff both refused, and a failed call
-- leaves the previous set completely intact. NOT applied to production,
-- which remains paused, per the standing hard rule.

create or replace function public.replace_staff_permissions(
  p_staff_id     uuid,
  p_permissions  text[],
  p_granted_by   uuid
)
returns void
language plpgsql
as $$
begin
  if not exists (select 1 from public.staff where id = p_staff_id) then
    raise exception 'Staff member % not found', p_staff_id;
  end if;

  delete from public.staff_permissions where staff_id = p_staff_id;

  if coalesce(array_length(p_permissions, 1), 0) > 0 then
    insert into public.staff_permissions (staff_id, permission, granted_by)
    select p_staff_id, perm::permission, p_granted_by
    from unnest(p_permissions) as perm
    -- Tolerate a caller sending the same permission twice: the primary key
    -- would otherwise reject the whole request over a harmless duplicate.
    on conflict (staff_id, permission) do nothing;
  end if;
end;
$$;

comment on function public.replace_staff_permissions is
  'Sets a staff member''s permissions to exactly p_permissions, atomically. Use instead of a separate DELETE then INSERT.';
