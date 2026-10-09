import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesDeclaredType } from './fileSignature.js';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);

test('accepts real signatures', () => {
  assert.ok(matchesDeclaredType(Buffer.from('%PDF-1.7\n' + 'x'.repeat(20)), 'application/pdf'));
  assert.ok(
    matchesDeclaredType(
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]),
      'image/jpeg',
    ),
  );
  assert.ok(matchesDeclaredType(png, 'image/png'));
  assert.ok(
    matchesDeclaredType(
      Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]),
      'image/webp',
    ),
  );
  assert.ok(
    matchesDeclaredType(
      Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(8)]),
      'image/heic',
    ),
  );
});

test('refuses content that does not match the claimed type', () => {
  assert.equal(
    matchesDeclaredType(Buffer.from('<html><script>alert(1)</script></html>'), 'application/pdf'),
    false,
  );
  assert.equal(matchesDeclaredType(png, 'application/pdf'), false);
  assert.equal(matchesDeclaredType(Buffer.from('MZ' + 'x'.repeat(30)), 'image/png'), false);
  assert.equal(matchesDeclaredType(Buffer.from('tiny'), 'image/png'), false);
  assert.equal(matchesDeclaredType(png, 'text/html'), false);
});
