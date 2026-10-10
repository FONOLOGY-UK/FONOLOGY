const BACKSLASH = String.fromCharCode(92);
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), 'g');
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), 'g');

/**
 * JSON for an inline <script type="application/ld+json">. JSON.stringify leaves "<" alone, so a value
 * containing a closing script tag would end the element; escaping "<" (and the two JS line separators)
 * keeps the output valid JSON while making that impossible. Values here come from shop settings and
 * product text that staff type.
 */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, `${BACKSLASH}u003c`)
    .replace(LINE_SEPARATOR, `${BACKSLASH}u2028`)
    .replace(PARAGRAPH_SEPARATOR, `${BACKSLASH}u2029`);
}
