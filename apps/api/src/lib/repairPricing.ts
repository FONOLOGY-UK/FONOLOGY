import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import { db } from './db.js';

/**
 * Repair prices per device (0109) — the one place they are read.
 *
 * A device offers a repair at a price typed in by hand: one per sub-type (Original, OEM, Copy,
 * custom ones), or one flat price for a Diagnosis-only repair. No price = not offered on that
 * device, so it appears nowhere for it — not in the website's repair flow, not in job creation.
 * A price of 0 is a real, free repair.
 */

export interface RepairOffer {
  repairId: string;
  /** Null for a Diagnosis-only repair's flat price. */
  subTypeId: string | null;
  price: number;
}

/**
 * Everything a device can be repaired for, at what price. Only live choices: an active repair
 * type, and for a standard repair a sub-type that is not deleted and that the repair comes in.
 */
export async function offersForDevice(deviceId: string, executor: Kysely<DB> = db) {
  const rows = await executor
    .selectFrom('device_repair_prices as p')
    .innerJoin('repair_types as rt', 'rt.id', 'p.repair_type_id')
    .innerJoin('devices as d', 'd.id', 'p.device_id')
    .leftJoin('repair_sub_types as st', 'st.id', 'p.sub_type_id')
    .leftJoin('repair_type_sub_types as link', (join) =>
      join
        .onRef('link.repair_type_id', '=', 'p.repair_type_id')
        .onRef('link.sub_type_id', '=', 'p.sub_type_id'),
    )
    .select(['p.repair_type_id', 'p.sub_type_id', 'p.price', 'rt.diagnosis_only'])
    .where('p.device_id', '=', deviceId)
    .where('d.is_active', '=', true)
    .where('rt.is_active', '=', true)
    .where((eb) =>
      eb.or([
        eb.and([eb('rt.diagnosis_only', '=', true), eb('p.sub_type_id', 'is', null)]),
        eb.and([
          eb('rt.diagnosis_only', '=', false),
          eb('st.removed_at', 'is', null),
          eb('st.id', 'is not', null),
          eb('link.sub_type_id', 'is not', null),
        ]),
      ]),
    )
    .orderBy('st.sort_order')
    .execute();
  return rows.map((r): RepairOffer => ({
    repairId: r.repair_type_id,
    subTypeId: r.sub_type_id,
    price: r.price,
  }));
}

/** The price of one choice on one device, or null when it is not offered there. */
export async function offeredPrice(
  deviceId: string,
  repairId: string,
  subTypeId: string | null,
): Promise<number | null> {
  const offers = await offersForDevice(deviceId);
  const hit = offers.find((o) => o.repairId === repairId && o.subTypeId === (subTypeId ?? null));
  return hit ? hit.price : null;
}
