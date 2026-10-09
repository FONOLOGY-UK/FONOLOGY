import { describe, expect, it } from 'vitest';
import type { StorefrontVariant } from '@/lib/data/types';
import { chooseOption, findVariant, optionState } from './variation-select';

let n = 0;
function v(
  options: Record<string, string>,
  stockStatus: StorefrontVariant['stockStatus'] = 'in-stock',
): StorefrontVariant {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    options,
    price: 1000,
    stockStatus,
    name: 'Case',
    description: '',
    tag: null,
    compatibility: null,
    images: [],
  };
}

// 3 colours × 3 models, with Red / iPhone 13 Mini disabled (so absent) and White / 13 Pro out.
const variants = [
  v({ Colour: 'Black', Model: 'iPhone 13' }),
  v({ Colour: 'Black', Model: 'iPhone 13 Mini' }),
  v({ Colour: 'Black', Model: 'iPhone 13 Pro' }),
  v({ Colour: 'White', Model: 'iPhone 13' }),
  v({ Colour: 'White', Model: 'iPhone 13 Mini' }),
  v({ Colour: 'White', Model: 'iPhone 13 Pro' }, 'out-of-stock'),
  v({ Colour: 'Red', Model: 'iPhone 13' }, 'out-of-stock'),
  v({ Colour: 'Red', Model: 'iPhone 13 Pro' }),
];

describe('variation choice', () => {
  it('finds the exact combination', () => {
    expect(findVariant(variants, { Colour: 'White', Model: 'iPhone 13' })).toBe(variants[3]);
    expect(findVariant(variants, { Colour: 'Red', Model: 'iPhone 13 Mini' })).toBeUndefined();
  });

  it('keeps the other choices when the combination exists', () => {
    const on = { Colour: 'Black', Model: 'iPhone 13 Pro' };
    expect(chooseOption(variants, on, 'Colour', 'White')).toBe(variants[5]);
  });

  it('moves to the closest real combination that has the clicked value', () => {
    // Red / iPhone 13 Mini does not exist: Red is kept, the model changes — preferring in stock.
    const on = { Colour: 'Black', Model: 'iPhone 13 Mini' };
    const next = chooseOption(variants, on, 'Colour', 'Red');
    expect(next?.options.Colour).toBe('Red');
    expect(next).toBe(variants[7]);
  });

  it('labels each option for the current choices', () => {
    const on = { Colour: 'Black', Model: 'iPhone 13 Mini' };
    expect(optionState(variants, on, 'Colour', 'Black')).toBe('on');
    expect(optionState(variants, on, 'Colour', 'White')).toBe('available');
    expect(optionState(variants, on, 'Colour', 'Red')).toBe('elsewhere');
    const pro = { Colour: 'Black', Model: 'iPhone 13 Pro' };
    expect(optionState(variants, pro, 'Colour', 'White')).toBe('out');
    expect(optionState(variants, { Colour: 'Red', Model: 'iPhone 13' }, 'Colour', 'Red')).toBe(
      'out',
    );
  });
});
