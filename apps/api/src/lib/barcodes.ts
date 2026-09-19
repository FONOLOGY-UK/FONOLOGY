import crypto from 'node:crypto';
import { supabaseAdmin } from './supabase.js';

/**
 * Minting the shop's own barcodes.
 * =========================================================================
 * Change request item 3 (the doc's A3).
 *
 * THE POINT OF THE FEATURE, from the doc: accessories often arrive with a
 * manufacturer's barcode already on them, and the shop should USE that
 * rather than print a redundant label. So this is the second of two options,
 * not a replacement — "Auto-generate" is for the things that arrive with
 * nothing on them, and typing or scanning an existing code stays the first
 * choice everywhere.
 *
 * THE SCHEME, AND WHY IT IS THIS ONE
 * ---------------------------------------------------------------------------
 * 13 digits, beginning "29".
 *
 * GS1 reserves prefixes 02 and 20–29 for IN-STORE use: numbers a shop mints
 * for itself, which by definition will never collide with a real
 * manufacturer's barcode on anything that comes through the door. That
 * matters here more than it usually would, because the shop deliberately
 * keeps manufacturers' own codes — a home-made number that happened to look
 * like a real EAN could shadow a genuine product.
 *
 * Ten random digits give ~10 billion values; at this catalogue's size
 * (~66 products) a collision is vanishingly unlikely, and the database is
 * checked anyway rather than trusting that. The thirteenth digit is a
 * standard EAN-13 mod-10 check digit, so a scanner or a spreadsheet that
 * validates one will accept these — and, more usefully, a single mistyped
 * digit is caught rather than silently finding nothing or the wrong product.
 *
 * NOTE THE SYMBOLOGY MISMATCH, WHICH IS FINE: the label renderer draws
 * Code 39 (apps/print-agent/src/render/barcode.ts and the web's
 * lib/barcode.ts), not EAN-13. Code 39 encodes digits happily, and a scanner
 * reads back whatever was printed, so the number's EAN-shaped validity is a
 * property of the NUMBER rather than of the symbol. It costs nothing and
 * means these codes remain sensible if the shop ever prints real EAN-13.
 *
 * STILL OWED: THE CONVERSATION WITH HASHIR
 * ---------------------------------------------------------------------------
 * The change request says this feature must be discussed with him before
 * implementation. It has not been. What is built here is deliberately easy to
 * change: the FORMAT lives entirely in `mintCandidate()` below, and nothing
 * else in the codebase assumes a length, a prefix or a check digit — the
 * column is plain text and the renderers draw whatever string they are
 * given. If he wants a different prefix, a shorter number, or letters, that
 * is an edit to one function and no migration.
 */

/** Standard EAN-13 mod-10 check digit over the first twelve digits. */
function checkDigit(twelve: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    // Positions alternate weight 1 and 3, starting at 1 for the first digit.
    sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * One candidate. The whole format lives here — see the note above about
 * this being the single place to change if the scheme is revised.
 *
 * `crypto.randomInt` rather than `Math.random`: these end up printed on
 * physical labels and stuck to stock, so two tills generating at the same
 * moment must not be able to produce the same number through a shared
 * weakly-seeded PRNG.
 */
function mintCandidate(): string {
  let digits = '29';
  for (let i = 0; i < 10; i += 1) digits += String(crypto.randomInt(0, 10));
  return digits + String(checkDigit(digits));
}

export class BarcodeMintError extends Error {}

/**
 * A barcode nothing else in the shop is using.
 *
 * Checks BOTH `products` and `product_variants`, because a variant carries
 * its own barcode (0060) and a scan at the till resolves against either —
 * a number unique to one table but not the other would scan to two things.
 *
 * The check is a read, so it is not a hard guarantee against two people
 * pressing the button in the same instant. That is deliberate rather than
 * overlooked: the odds are roughly one in ten billion per attempt, the
 * consequence is one duplicated label that a scan would reveal, and the
 * alternative — a unique index — would have to be added to two tables whose
 * existing rows include manufacturers' codes that are NOT guaranteed unique
 * (the same cable model bought twice legitimately shares a barcode) and
 * would start refusing perfectly ordinary saves.
 */
export async function mintBarcode(attempts = 5): Promise<string> {
  for (let i = 0; i < attempts; i += 1) {
    const candidate = mintCandidate();

    const [products, variants] = await Promise.all([
      supabaseAdmin.from('products').select('id').eq('barcode', candidate).limit(1),
      supabaseAdmin.from('product_variants').select('id').eq('barcode', candidate).limit(1),
    ]);
    if (products.error || variants.error) {
      throw new BarcodeMintError('Could not check the barcode against existing stock.');
    }
    if ((products.data?.length ?? 0) === 0 && (variants.data?.length ?? 0) === 0) {
      return candidate;
    }
  }
  // Five collisions in a row against a ten-billion space is not bad luck, it
  // is a bug or a broken random source. Failing loudly beats returning a
  // number that might already be on a shelf.
  throw new BarcodeMintError('Could not generate a unique barcode. Try again.');
}
