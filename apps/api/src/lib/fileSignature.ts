/**
 * Does the file's content match the type the browser CLAIMED for it?
 *
 * multer's `mimetype` is just the Content-Type header the uploader chose, so an allowlist on it alone lets
 * any bytes in as "application/pdf". These are the magic numbers for the types the app accepts; a mismatch
 * is refused before anything is stored. (Checks the leading bytes only - it is a sanity gate, not a
 * malware scanner.)
 */
const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString('latin1');

const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
  'heif',
]);

export function matchesDeclaredType(buffer: Buffer, mimetype: string): boolean {
  if (buffer.length < 12) return false;
  switch (mimetype) {
    case 'application/pdf':
      // The header may be preceded by a few junk bytes; the spec allows it within the first 1024.
      return buffer.subarray(0, 1024).includes('%PDF-');
    case 'image/jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return buffer[0] === 0x89 && ascii(buffer, 1, 4) === 'PNG';
    case 'image/webp':
      return ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP';
    case 'image/gif':
      return ascii(buffer, 0, 4) === 'GIF8';
    case 'image/heic':
    case 'image/heif':
      return ascii(buffer, 4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(buffer, 8, 12));
    default:
      return false;
  }
}
