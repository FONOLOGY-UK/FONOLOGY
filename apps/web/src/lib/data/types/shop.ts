import { z } from 'zod';

/**
 * PUBLIC shop details — `GET /shop`.
 *
 * The single source of truth for every fact the customer sees about the shop:
 * where it is, when it opens, how long they have to bring something back.
 *
 * This exists because those facts used to live in FIVE hardcoded copies
 * (lib/site.ts's CONTACT, its MENU_META, the homepage JSON-LD's literal
 * strings, the receipt, and the API's Brevo sender default) and the real
 * values were only ever reachable through `GET /admin/settings`, which
 * requires `settings.manage`. The storefront has no session; counter staff
 * don't hold that permission. So nothing that actually faced a customer could
 * read the row that 0009 says everything must read.
 *
 * Matches the REAL API response in apps/api/src/routes/shop.routes.ts, field
 * for field — not the mock's echo.
 */

export const openingHoursEntrySchema = z.object({
  day: z.string(),
  open: z.string().nullable(),
  close: z.string().nullable(),
  closed: z.boolean(),
});
export type OpeningHoursEntry = z.infer<typeof openingHoursEntrySchema>;

export const shopDetailsSchema = z.object({
  shopName: z.string(),
  shopAddress: z.string().nullable(),
  shopPhone: z.string().nullable(),
  shopEmail: z.string().nullable(),
  openingHours: z.array(openingHoursEntrySchema),
  returnWindowDays: z.number().int().min(0),
  nextDayCutoffTime: z.string().nullable(),
  idDocumentRetentionDays: z.number().int().positive(),
  receiptHeaderText: z.string().nullable(),
  receiptFooterText: z.string().nullable(),
});
export type ShopDetails = z.infer<typeof shopDetailsSchema>;

/** `+44 141 374 0365` → `tel:+441413740365`. */
export function telHref(phone: string | null): string {
  return phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : '#';
}

export function mailtoHref(email: string | null): string {
  return email ? `mailto:${email}` : '#';
}

/**
 * "61c Main Street, Thornliebank, Glasgow, G46 7RX" → the parts, for layouts
 * that stack the address over several lines (the footer, the contact page).
 * Splitting rather than storing separate columns keeps one editable field in
 * settings — an owner types their address the way they'd write it.
 */
export function addressLines(address: string | null): string[] {
  if (!address) return [];
  return address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The last comma-part, which for a UK address is the postcode. */
export function addressPostcode(address: string | null): string {
  const parts = addressLines(address);
  return parts.length ? (parts[parts.length - 1] ?? '') : '';
}

/** Everything except the postcode — the one-line form used inline in copy. */
export function addressShort(address: string | null): string {
  const parts = addressLines(address);
  return parts.slice(0, -1).join(', ');
}

/**
 * Collapse the seven day-rows into the "Mon–Fri 09:30–19:00" style ranges the
 * footer and contact page show, merging consecutive days that share hours.
 */
export function groupedHours(hours: OpeningHoursEntry[]): { days: string; time: string }[] {
  const out: { days: string; time: string }[] = [];
  for (const entry of hours) {
    const time = entry.closed ? 'Closed' : `${entry.open}–${entry.close}`;
    const last = out[out.length - 1];
    if (last && last.time === time) {
      // Keep only the first and current day: "Mon–Fri", never "Mon–Tue–Wed".
      const [first] = last.days.split('–');
      last.days = `${first}–${entry.day}`;
    } else {
      out.push({ days: entry.day, time });
    }
  }
  return out;
}
