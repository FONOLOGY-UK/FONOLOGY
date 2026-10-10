/**
 * Server-side HTML allowlist for staff-authored rich text (product and variation descriptions).
 *
 * The admin form already sanitises in the browser, but that is a courtesy: the API accepts any caller with
 * `inventory.manage`, and the storefront writes the stored description straight into the page. So the
 * server is the real gate. The rule is simple enough to be obviously safe — it is a tokenizer, not a
 * parser, and it only EVER emits two things: bare allowlisted tags (no attributes at all) and escaped text.
 * Anything it does not recognise as a complete tag has its `<` escaped, so malformed or nested tricks
 * (`<<img …`, `<scr<script>ipt>`) cannot produce markup.
 *
 * The allowlist matches `apps/web/src/components/admin/rich-text.tsx` so a description the editor produces
 * round-trips unchanged.
 */
const ALLOWED = new Set([
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ul',
  'ol',
  'li',
  'div',
  'span',
  'h3',
  'h4',
]);
/** Tags whose CONTENT is dropped too, not just the tag. */
const DROP_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'svg',
  'math',
]);
const TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)(?:\s[^<>]*)?\/?>/;

function escapeText(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sanitizeHtml(input: string): string {
  let out = '';
  let i = 0;
  while (i < input.length) {
    const lt = input.indexOf('<', i);
    if (lt === -1) {
      out += escapeText(input.slice(i));
      break;
    }
    out += escapeText(input.slice(i, lt));

    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4);
      i = end === -1 ? input.length : end + 3;
      continue;
    }

    const match = TAG.exec(input.slice(lt));
    if (!match) {
      out += '&lt;';
      i = lt + 1;
      continue;
    }
    const closing = match[1] === '/';
    const name = match[2]!.toLowerCase();
    i = lt + match[0].length;

    if (DROP_CONTENT.has(name)) {
      if (!closing) {
        const close = new RegExp(String.raw`</${name}\s*>`, 'i').exec(input.slice(i));
        i = close ? i + close.index + close[0].length : input.length;
      }
      continue;
    }
    if (ALLOWED.has(name)) out += name === 'br' ? '<br>' : `<${closing ? '/' : ''}${name}>`;
  }
  return out.trim();
}
