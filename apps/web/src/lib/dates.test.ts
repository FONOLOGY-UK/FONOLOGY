import { afterEach, describe, expect, it, vi } from 'vitest';
import { isoDay, isoDaysAgo, isoMonthRange, isoWeekRange } from './dates';

/**
 * Change request item 8's calendar-boundary presets.
 *
 * These are the ones worth pinning: a rolling "last 7 days" is hard to get
 * wrong, but "last week" landing on the wrong Monday, or "last month" from the
 * 31st quietly giving a month with a 31st in it, are both silent — the numbers
 * still look like numbers. Every case here is a date a human would pick to
 * break it: a Monday, a Sunday, the 31st, the 1st, a leap February.
 *
 * Everything is asserted in Europe/London, which is what isoDay() computes and
 * what the shop's own trading day means. Times are set to midday UTC so the
 * test doesn't accidentally depend on which side of a BST transition it runs.
 */

function freeze(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${iso}T12:00:00Z`));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('isoWeekRange — whole Monday-to-Sunday weeks', () => {
  it('from a Wednesday, last week is the Monday-to-Sunday that finished', () => {
    freeze('2026-09-16'); // a Wednesday
    expect(isoWeekRange(1)).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('from a Monday, last week is the seven days immediately before it', () => {
    freeze('2026-09-14'); // a Monday — the off-by-one that bites
    expect(isoWeekRange(1)).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('from a Sunday, last week is still the previous week, not the current one', () => {
    freeze('2026-09-20'); // a Sunday: UK weeks end here, they do not start here
    expect(isoWeekRange(1)).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('this week runs from the current Monday', () => {
    freeze('2026-09-16');
    expect(isoWeekRange(0)).toEqual({ from: '2026-09-14', to: '2026-09-20' });
  });

  it('crosses a month boundary without losing days', () => {
    freeze('2026-10-01'); // a Thursday
    expect(isoWeekRange(1)).toEqual({ from: '2026-09-21', to: '2026-09-27' });
  });
});

describe('isoMonthRange — whole calendar months', () => {
  it('last month from the 31st does not give a month that has no 31st', () => {
    freeze('2026-10-31');
    expect(isoMonthRange(1)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('this month starts on the 1st', () => {
    freeze('2026-09-16');
    expect(isoMonthRange(0).from).toBe('2026-09-01');
    expect(isoMonthRange(0).to).toBe('2026-09-30');
  });

  it('crosses the year boundary backwards', () => {
    freeze('2026-01-15');
    expect(isoMonthRange(1)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('gets February right in a leap year', () => {
    freeze('2028-03-10');
    expect(isoMonthRange(1)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('gets February right in a non-leap year', () => {
    freeze('2026-03-10');
    expect(isoMonthRange(1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('the London day itself', () => {
  it('yesterday crosses a BST-to-GMT transition correctly', () => {
    // The clocks go back on Sunday 25 October 2026.
    freeze('2026-10-26');
    expect(isoDay()).toBe('2026-10-26');
    expect(isoDaysAgo(1)).toBe('2026-10-25');
  });
});
