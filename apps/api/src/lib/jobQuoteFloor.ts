import { db, rpc } from './db.js';
import { isUuid } from './uuid.js';
import { formatPence } from './money.js';

/**
 * The shop's price a staff quote may not go below — since 0109 (tester change C-3) the price the
 * DEVICE has for the chosen repair and sub-type, typed in on Device Models.
 *
 * The authority is 0082's quote-floor trigger (job_quote_floor -> repair_price); this is the
 * friendlier version a step earlier, so the person at the counter gets a sentence naming the
 * price instead of a raised exception. Deliberately takes the selection, never a price: a floor
 * supplied by the caller is a floor the caller can lower.
 *
 * Null = no floor: nothing picked, or the device does not offer that choice (job creation refuses
 * that case itself).
 */
export interface RepairSelection {
  repairTypeId?: string | null;
  deviceId?: string | null;
  /** Null for a Diagnosis-only repair (0109). */
  subTypeId?: string | null;
}

/**
 * The device's own price for this repair (0109, tester change C-3) — null when nothing is picked,
 * or when that device does not offer it. Same function the DB trigger floors against.
 */
export async function getQuoteFloor(selection: RepairSelection): Promise<number | null> {
  const { repairTypeId, deviceId, subTypeId } = selection;
  if (!isUuid(repairTypeId) || !isUuid(deviceId)) return null;
  if (subTypeId && !isUuid(subTypeId)) return null;
  return rpc<number | null>('repair_price', {
    p_device_id: deviceId,
    p_repair_type_id: repairTypeId,
    p_sub_type_id: subTypeId ?? null,
  });
}

/** The floor for a job that already exists, read from its own stored selection. */
export async function getJobQuoteFloor(jobId: string): Promise<number | null> {
  if (!isUuid(jobId)) return null;
  const job = await db
    .selectFrom('jobs')
    .select(['repair_type_id', 'device_id', 'sub_type_id'])
    .where('id', '=', jobId)
    .executeTakeFirst();
  if (!job) return null;
  return getQuoteFloor({
    repairTypeId: job.repair_type_id,
    deviceId: job.device_id,
    subTypeId: job.sub_type_id,
  });
}

/** One wording for the refusal, so the two call sites cannot drift apart. */
export function belowFloorMessage(floor: number, revised: boolean): string {
  return `${revised ? 'That revised quote' : 'That quote'} is below the shop price for this repair (${formatPence(floor)}). You can quote more, never less.`;
}
