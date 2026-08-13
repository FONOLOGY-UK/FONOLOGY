/**
 * Making text safe for a thermal printer's codepage.
 * =========================================================================
 * THIS IS NOT COSMETIC. It was written after testing the encoder against real
 * input, and it fixes output that would otherwise be quietly wrong on paper —
 * the exact failure class this project keeps getting bitten by.
 *
 * Measured against @point-of-sale/receipt-printer-encoder v3.0.3 with cp437,
 * by encoding strings and reading the bytes back:
 *
 *   "café"  (decomposed e + acute)  -> 63 61 66 65 3f   "cafe?"   WRONG
 *   "café"   (precomposed)           -> 63 61 66 82      "caf" + e-acute  OK
 *   "’"      (smart apostrophe)      -> 3f               "?"       WRONG
 *   "€"      (euro sign)             -> 3f               "?"       WRONG
 *   U+00A0   (non-breaking space)    -> ff               clone-dependent
 *
 * Nothing throws for any of those. The encoder substitutes "?" silently, so a
 * customer called Zoé gets a receipt reading "Zoe?" and no error is
 * raised anywhere. Two of those cases are entirely avoidable:
 *
 *   - DECOMPOSED ACCENTS are just a normalisation away from working. Text
 *     typed on macOS, and text pasted out of some web forms, is routinely NFD.
 *     normalize('NFC') composes it into the single character cp437 has.
 *
 *   - SMART PUNCTUATION comes from copy-paste and from phone keyboards that
 *     autocorrect apostrophes. A straight quote is in every codepage; a curly
 *     one is in almost none.
 *
 * What is left after this pass is genuinely outside the codepage (Arabic,
 * Chinese, emoji in a device description), and "?" is the honest answer there.
 * A shop in Glasgow serving customers with names in other scripts is a real
 * scenario, and the real fix is an image-based receipt — a much larger change,
 * and not one to make on a guess about a printer nobody has plugged in yet.
 * Flagged in README.md rather than half-solved here.
 */

/**
 * Characters with an exact, uncontroversial ASCII equivalent.
 *
 * Deliberately conservative. This is NOT a general transliterator: turning
 * "ü" into "u" would be silently editing a customer's name, which is
 * worse than printing it slightly wrong. Only punctuation and spacing are
 * touched, plus two currency symbols where the three-letter code is
 * unambiguous.
 *
 * Written with \u escapes rather than literal glyphs on purpose — this file
 * is about characters that are easy to confuse with each other, and a literal
 * curly quote in the source is indistinguishable from a straight one at a
 * glance in a diff.
 */
const REPLACEMENTS: Array<[RegExp, string]> = [
  [/[\u2018-\u201B]/g, "'"], // curly single quotes
  [/[\u201C-\u201F]/g, '"'], // curly double quotes
  [/[\u2010-\u2015]/g, '-'], // hyphen, en dash, em dash
  [/\u2026/g, '...'], // ellipsis
  [/\u2022/g, '*'], // bullet
  [/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' '], // NBSP and exotic spaces
  [/[\u200B-\u200D\uFEFF]/g, ''], // zero-width junk, invisible on paper anyway
  [/\u20AC/g, 'EUR'],
  [/\u00A5/g, 'JPY'],
];

/**
 * Normalise and simplify text before it reaches the encoder.
 *
 * Note "£" (pound) is NOT touched: it is present in cp437 at 0x9C —
 * verified against the encoder — and it is the shop's own currency. Whether
 * the POS80GXa actually renders 0x9C as a pound sign is a property of that
 * clone and remains UNVERIFIED until the encoding test print is photographed.
 */
export function sanitiseForPrinter(input: string): string {
  // NFC first: it composes "e + combining acute" into the single character the
  // codepage knows about, so both the replacements below and the encoder see
  // what they expect.
  let out = input.normalize('NFC');
  for (const [pattern, replacement] of REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  // Control characters would be interpreted as ESC/POS commands. A stray 0x1B
  // inside a customer's device description could reconfigure the printer
  // mid-receipt — or cut the paper early — so they are removed rather than
  // escaped. Tab included: column positions are computed here, never delegated
  // to the printer's tab stops. 0x7F (DEL) is in the range for the same reason.
  //
  // Written as \u escapes, like REPLACEMENTS above: a raw 0x1B sitting in this
  // source file is invisible in an editor and survives a copy-paste, which is
  // precisely the class of bug this function exists to stop.
  // Matching control characters IS the point of this function, so the rule is
  // switched off for this one line and left on everywhere else.
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\u0000-\u001F\u007F]/g, ' ');
  return out;
}

/**
 * Integer pence to a printable amount. Pence everywhere else, pounds only
 * here — the standing rule, and the reason this is one function rather than
 * an expression repeated at every call site.
 */
export function formatPence(pence: number): string {
  const negative = pence < 0;
  const abs = Math.abs(Math.round(pence));
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/**
 * UK date and time from a frozen ISO timestamp: "06/08/2026 16:03".
 * =========================================================================
 * PINNED TO Europe/London, NOT THE PC'S LOCAL TIMEZONE.
 *
 * This is the timestamp on the piece of paper the customer keeps, and it is
 * what anchors the returns window. Deriving it from the till PC's clock made
 * the printed time a property of a machine setting nobody checks: measured
 * before the fix, a 15:03Z sale printed as "20:03" on a UTC+5 machine. It
 * would have been right in the shop and quietly wrong everywhere else —
 * including on any PC whose timezone was set carelessly during setup.
 *
 * Europe/London also gets BST right without a DST table here: the IANA zone
 * carries the transitions, so a July sale prints UTC+1 and a January sale
 * prints UTC+0, automatically.
 *
 * This matches how the rest of the codebase treats UK time — `shop_day` and
 * `shop_hour` force it explicitly rather than trusting a host clock.
 *
 * One copy, shared by both printers. It was written identically in receipt.ts
 * and label.ts, which is exactly how a correction like this one lands on the
 * receipt and not the bench ticket.
 */
const UK_TIMEZONE = 'Europe/London';

/**
 * Built once. Constructing an Intl.DateTimeFormat per receipt is measurably
 * slow, and this one is stateless.
 *
 * Null when the runtime has no ICU data for the zone — see formatWhen. Node 20+
 * ships full ICU, and the installer requires Node 20+, so this is the
 * defensive branch rather than the expected one.
 */
const ukFormatter: Intl.DateTimeFormat | null = (() => {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: UK_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return null;
  }
})();

/**
 * Does this runtime actually have the UK timezone? Called at startup so a
 * missing-ICU build is one clear line in the log rather than a wrong time
 * discovered on a customer's receipt. Same pattern as assertCodepageSupported.
 */
export function isUkTimezoneAvailable(): boolean {
  if (!ukFormatter) return false;
  // A formatter can exist and still silently be UTC if the zone was ignored.
  // Checking a known BST instant proves the transitions are really loaded:
  // 2026-08-06T15:03Z is 16:03 in London, not 15:03.
  return formatWhen('2026-08-06T15:03:00.000Z') === '06/08/2026 16:03';
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  // An unparseable timestamp is echoed rather than replaced with a plausible
  // wrong one. A visibly odd string on a receipt is a question; a confidently
  // wrong date is not.
  if (Number.isNaN(d.getTime())) return iso;

  if (!ukFormatter) {
    // No ICU. Print UTC and SAY so, rather than emitting a bare time that
    // looks local and is not.
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
    );
  }

  // formatToParts rather than format(): en-GB renders as "06/08/2026, 16:03"
  // and the separator is a locale detail that has changed between ICU
  // versions. Assembling from parts pins the output regardless.
  const parts = ukFormatter.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/**
 * Break text into lines that fit the paper.
 *
 * The printer wraps on its own, but at ITS idea of the width — which is one of
 * the things "broadly ESC/POS compatible" gets wrong on a clone. Wrapping here
 * means the break points are ours and are the same on every device.
 */
export function wrap(text: string, columns: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= columns) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
    // A single word longer than the paper is chopped rather than allowed to
    // wrap unpredictably.
    while (current.length > columns) {
      lines.push(current.slice(0, columns));
      current = current.slice(columns);
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}
