/**
 * Phone numbers are stored exactly as typed ("07700 900123", "+44 7700 900123", "447700900123"),
 * landlines included. A text can only go to a UK mobile, and Brevo wants it as the international
 * number without a "+": 447700900123. Anything else — a landline, a foreign or half-typed number —
 * is null, and the caller skips the text and says why.
 */
export function toUkMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith('0')) digits = `44${digits.slice(1)}`;
  // 44 7xxx xxxxxx: twelve digits, mobile range.
  return /^447\d{9}$/.test(digits) ? digits : null;
}

/** "447700900123" → "…0123", for logs: enough to tell numbers apart, not enough to dial. */
export function maskPhone(phone: string): string {
  return `…${phone.slice(-4)}`;
}
