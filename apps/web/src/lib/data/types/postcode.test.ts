import { describe, expect, it } from 'vitest';
import { ukPostcodeSchema } from './common';

/**
 * QA round 4, BUG-05 (Critical): "valid UK postcodes incorrectly rejected at checkout".
 * Every real outward-code shape (A9, A99, A9A, AA9, AA99, AA9A), with and without the space,
 * in any case, with stray whitespace — and a set of things that must still be refused.
 */
describe('ukPostcodeSchema', () => {
  const valid = [
    'G46 7RX', // the shop
    'G46 7AA',
    'EC1A 1BB', // AA9A
    'W1A 0AX', // A9A
    'M1 1AE', // A9
    'B33 8TH', // A99
    'CR2 6XH', // AA9
    'DN55 1PT', // AA99
    'SW1A 2AA', // Downing Street
    'KA27 8AB', // Isle of Arran (remote zone)
    'ZE1 0AA', // Shetland
    'BT1 1AA', // Northern Ireland
    'IM1 1AA', // Isle of Man
    'EH1 1YZ',
    'G12 8QQ',
    'e1 6an', // lower case
    'g467rx', // no space
    'EC1A1BB',
    '  G46 7RX  ', // stray whitespace
    'G46  7RX', // two spaces
  ];
  const invalid = [
    '',
    '12345',
    'ABCDE',
    'G46',
    'G46 7R',
    'G46 7RXX',
    'GG46 7RX1',
    'A 1AA',
    '1G46 7RX',
    'G46 7R1',
    'G46-7RX',
  ];

  it.each(valid)('accepts %j', (code) => {
    expect(ukPostcodeSchema.safeParse(code).success).toBe(true);
  });

  it.each(invalid)('refuses %j', (code) => {
    expect(ukPostcodeSchema.safeParse(code).success).toBe(false);
  });
});
