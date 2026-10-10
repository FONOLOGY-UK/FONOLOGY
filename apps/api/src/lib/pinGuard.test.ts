import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { beginPinAttempt, endPinAttempt, pinLimits, resetPinGuard } from './pinGuard.js';

beforeEach(() => resetPinGuard());

const limits = (session = 's1', account = 'a1', ip: string | undefined = '1.1.1.1') =>
  pinLimits({ session, account, ip });

test('a burst of parallel guesses is cut off at the session limit, before any verification', () => {
  // Fifty requests arrive "at once": each one is charged synchronously, so only the first 5 are let through.
  const allowed = Array.from({ length: 50 }, () => beginPinAttempt(limits(), 1_000) === 0).filter(
    Boolean,
  );
  assert.equal(allowed.length, 5);
});

test('a locked key refuses and charges nothing, then unlocks after the wait', () => {
  for (let i = 0; i < 5; i++) beginPinAttempt(limits(), 1_000);
  const wait = beginPinAttempt(limits(), 1_001);
  assert.ok(wait > 0 && wait <= 30_000);
  assert.equal(beginPinAttempt(limits(), 1_000 + 30_001), 0);
});

test('a correct PIN gives the attempt back', () => {
  for (let i = 0; i < 4; i++) {
    const l = limits();
    assert.equal(beginPinAttempt(l, 1_000), 0);
    endPinAttempt(l, true);
  }
  // still nowhere near the limit
  for (let i = 0; i < 4; i++) assert.equal(beginPinAttempt(limits(), 1_000), 0);
});

test('one session cannot spread guesses over many accounts', () => {
  let refused = 0;
  for (let i = 0; i < 30; i++)
    if (beginPinAttempt(limits('same-session', `acct-${i}`), 1_000) > 0) refused += 1;
  assert.ok(refused >= 24, `refused ${refused}`);
});

test('many sessions cannot share one account past the account ceiling', () => {
  let allowed = 0;
  for (let i = 0; i < 100; i++)
    if (beginPinAttempt(limits(`session-${i}`, 'victim', undefined), 1_000) === 0) allowed += 1;
  assert.ok(allowed <= 16, `allowed ${allowed}`);
});

test('locks escalate on repeated lock-outs', () => {
  for (let i = 0; i < 5; i++) beginPinAttempt(limits(), 0);
  const first = beginPinAttempt(limits(), 1);
  for (let i = 0; i < 5; i++) beginPinAttempt(limits(), 30_001 + i);
  const second = beginPinAttempt(limits(), 30_010);
  assert.ok(second > first, `${second} should exceed ${first}`);
});
