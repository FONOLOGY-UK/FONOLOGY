import { supabaseAdmin } from './supabase.js';

/**
 * The admin-defined price a staff quote may not go below.
 *
 * Change request item 6. The authority is 0079's `jobs_validate_quote_floor`
 * trigger — this is the friendlier version a step earlier, so the person at
 * the counter gets a sentence naming the shop price instead of a raised
 * exception forwarded as a 409. Both read the SAME function,
 * `repair_quote_price()`, which is also what /admin/repair-pricing shows and
 * what the public /repair quote endpoint quotes with. One definition of "the
 * shop price for this repair", used in four places.
 *
 * Deliberately takes the selection, never a price. A floor supplied by the
 * caller is a floor the caller can lower — the standing "the server computes
 * every money figure" rule, applied to a minimum instead of a total.
 *
 * Returns null when there is no floor to apply, which is a normal outcome and
 * not an error:
 *   - the job is free-text, with no catalogue repair picked
 *   - the repair type is diagnosis-only (water damage, data recovery), whose
 *     three base prices are all null by `repair_types_all_or_no_pricing`, so
 *     repair_quote_price() correctly returns null too
 */
export interface RepairSelection {
  repairTypeId?: string | null;
  deviceId?: string | null;
  partTier?: 'original' | 'oem' | 'copy' | null;
}

export async function getQuoteFloor(selection: RepairSelection): Promise<number | null> {
  const { repairTypeId, deviceId, partTier } = selection;
  if (!repairTypeId || !deviceId || !partTier) return null;

  const { data, error } = await supabaseAdmin.rpc('repair_quote_price', {
    p_repair_type_id: repairTypeId,
    p_device_id: deviceId,
    p_tier: partTier,
  });
  if (error) return null;
  return (data as number | null) ?? null;
}

/** The floor for a job that already exists, read from its own stored selection. */
export async function getJobQuoteFloor(jobId: string): Promise<number | null> {
  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('repair_type_id, device_id, part_tier')
    .eq('id', jobId)
    .maybeSingle();
  if (!job) return null;
  return getQuoteFloor({
    repairTypeId: job.repair_type_id as string | null,
    deviceId: job.device_id as string | null,
    partTier: job.part_tier as 'original' | 'oem' | 'copy' | null,
  });
}

/** One wording for the refusal, so the two call sites cannot drift apart. */
export function belowFloorMessage(floor: number, revised: boolean): string {
  const price = (floor / 100).toFixed(2);
  return `${revised ? 'That revised quote' : 'That quote'} is below the shop price for this repair (£${price}). You can quote more, never less.`;
}
