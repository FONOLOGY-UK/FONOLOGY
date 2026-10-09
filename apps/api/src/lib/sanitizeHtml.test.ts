import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htmlToPlainText, sanitizeHtml } from './sanitizeHtml.js';

test('keeps the formatting the editor produces', () => {
  const html = '<p>Fast <strong>60W</strong> charger</p><ul><li>1m</li><li>braided</li></ul><br>';
  assert.equal(sanitizeHtml(html), html);
});

test('strips every attribute from allowed tags', () => {
  assert.equal(sanitizeHtml('<p onclick="x()" style="color:red">hi</p>'), '<p>hi</p>');
});

test('drops script, style and iframe including their content', () => {
  assert.equal(sanitizeHtml('a<script>alert(1)</script>b'), 'ab');
  assert.equal(sanitizeHtml('a<style>*{display:none}</style>b'), 'ab');
  assert.equal(sanitizeHtml('a<iframe src="//evil"></iframe>b'), 'ab');
  assert.equal(sanitizeHtml('a<script>never closed'), 'a');
});

test('removes event-handler tags that are not on the allowlist', () => {
  assert.equal(sanitizeHtml('<img src=x onerror=alert(1)>text'), 'text');
  assert.equal(sanitizeHtml('<a href="javascript:alert(1)">x</a>'), 'x');
});

test('malformed and nested tricks never produce markup', () => {
  for (const evil of [
    '<<img src=x onerror=alert(1)>',
    '<scr<script>ipt>alert(1)</scr</script>ipt>',
    '<p/onmouseover=alert(1)>',
    '<!--<img src=x onerror=1>-->',
    '<svg/onload=alert(1)>',
    '< script>alert(1)</ script>',
  ]) {
    const out = sanitizeHtml(evil);
    assert.ok(
      !/<(?!\/?(p|br|b|strong|i|em|u|ul|ol|li|div|span|h3|h4)>)/i.test(out),
      `${evil} -> ${out}`,
    );
    assert.ok(
      !/onerror|onload|onmouseover/i.test(out.replace(/&lt;[^]*?&gt;/g, '')) || !out.includes('<'),
      `${evil} -> ${out}`,
    );
  }
});

test('stray angle brackets in text are escaped, not lost', () => {
  assert.equal(sanitizeHtml('5 < 6 and 7 > 3'), '5 &lt; 6 and 7 &gt; 3');
});

test('plain text helper', () => {
  assert.equal(htmlToPlainText('<p>Hello <b>world</b></p><script>x</script>'), 'Hello world');
});
