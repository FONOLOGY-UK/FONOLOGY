'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AnalyticsQuery } from '@/lib/data/types';
import { isoDay, isoDaysAgo, isoMonthRange, isoWeekRange } from '@/lib/dates';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Date-range filter shared by Overview, Payments and Reports (item 7:
 * day / month / year / custom). Lives in the URL (?range=…&from=…&to=…) so a
 * view can be refreshed, shared or bookmarked without losing its window.
 */

/**
 * Change request item 8 added five presets to the four that already worked.
 * Nothing was removed — the doc is explicit about that, and `30d`/`12m`/
 * `custom` are what every bookmarked admin URL in the shop already carries.
 *
 * The new ones split into two kinds, and the difference is the point:
 *
 *   ROLLING   `yesterday`, `7d` — N days back from today.
 *   CALENDAR  `lastWeek`, `thisMonth`, `lastMonth` — whole periods with real
 *             boundaries. On a Wednesday "last week" is the Monday-to-Sunday
 *             that finished, not the last seven days. An owner comparing this
 *             month's takings with last month's needs both to be real months,
 *             which is exactly what a rolling window cannot give them.
 *
 * Ordered shortest to longest so the row reads as a timeline rather than as
 * the order the requests arrived in.
 */
export type RangePreset =
  'today' | 'yesterday' | '7d' | 'lastWeek' | 'thisMonth' | 'lastMonth' | '30d' | '12m' | 'custom';

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: '7 days' },
  { id: 'lastWeek', label: 'Last week' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: '30d', label: '30 days' },
  { id: '12m', label: '12 months' },
  { id: 'custom', label: 'Custom' },
];

/** Every id above, so URL parsing can't drift out of step with the buttons. */
const PRESET_IDS = PRESETS.map((p) => p.id);

/**
 * A preset's actual window. Exported so it can be unit-tested without a
 * router — the calendar-boundary cases (a Monday, a 31st, a leap February)
 * are the ones worth pinning down, and they are unreachable through the hook.
 *
 * `custom` is the only preset that reads the from/to it is handed; every
 * other one computes its own window from today, which is why switching
 * presets clears those params from the URL.
 */
export function resolveRange(
  preset: RangePreset,
  custom: { from: string; to: string },
): AnalyticsQuery {
  const today = isoDay();
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = isoDaysAgo(1);
      return { from: day, to: day };
    }
    case '7d':
      return { from: isoDaysAgo(6), to: today };
    case 'lastWeek':
      return isoWeekRange(1);
    case 'thisMonth':
      // Deliberately ends TODAY, not on the last of the month: a month in
      // progress has no takings yet for the days that haven't happened, and
      // an end date in the future would make every average wrong.
      return { from: isoMonthRange(0).from, to: today };
    case 'lastMonth':
      return isoMonthRange(1);
    case '30d':
      return { from: isoDaysAgo(29), to: today };
    case '12m':
      return { from: isoDaysAgo(364), to: today };
    case 'custom':
      return custom;
  }
}

export function useAnalyticsRange(): {
  preset: RangePreset;
  query: AnalyticsQuery;
  setPreset: (preset: RangePreset) => void;
  setCustom: (part: { from?: string; to?: string }) => void;
} {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Checked against the button list rather than a hand-written union, so a
  // preset added above can never be one the URL silently falls back out of.
  const rawPreset = searchParams.get('range');
  const preset: RangePreset = (PRESET_IDS as string[]).includes(rawPreset ?? '')
    ? (rawPreset as RangePreset)
    : '30d';

  const today = isoDay();
  const from = searchParams.get('from') ?? isoDaysAgo(29);
  const to = searchParams.get('to') ?? today;

  const query: AnalyticsQuery = resolveRange(preset, { from, to });

  const replace = useCallback(
    (params: URLSearchParams) => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname],
  );

  const setPreset = useCallback(
    (next: RangePreset) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('range', next);
      if (next !== 'custom') {
        params.delete('from');
        params.delete('to');
      }
      replace(params);
    },
    [searchParams, replace],
  );

  const setCustom = useCallback(
    (part: { from?: string; to?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('range', 'custom');
      if (part.from) params.set('from', part.from);
      if (part.to) params.set('to', part.to);
      replace(params);
    },
    [searchParams, replace],
  );

  return { preset, query, setPreset, setCustom };
}

/**
 * BUG-15-followup #1: the date inputs used to sit INLINE, after the preset
 * buttons, in the same `flex flex-wrap` row — appearing pushed everything
 * after it sideways (or onto a new line, on a narrower screen), which read
 * as the whole filter bar shifting. They're a separate row now instead of a
 * fourth flex item: the preset button group never moves, appearing or not,
 * because nothing else ever shares its row. `items-start` on the outer grid
 * (not `items-center`) is what keeps the button group pinned to the
 * top-left rather than re-centering itself against the taller two-row stack
 * once the second row exists.
 */
export function RangePicker({
  preset,
  query,
  setPreset,
  setCustom,
}: ReturnType<typeof useAnalyticsRange>) {
  return (
    <div className="grid items-start gap-2">
      <div
        // Wraps now: nine presets don't fit one row on a laptop, and the
        // alternative — a dropdown — costs the at-a-glance "which window am I
        // looking at" that the pressed button gives for free.
        className="border-line bg-card rounded-ui flex w-fit flex-wrap gap-0.5 border p-0.5"
        role="group"
        aria-label="Date range"
      >
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            aria-pressed={preset === p.id}
            className={cn(
              'rounded-[10px] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.04em] transition-colors duration-150',
              preset === p.id ? 'bg-ink text-bone' : 'text-muted hover:text-ink',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' ? (
        <div className="animate-in fade-in-0 slide-in-from-top-1 flex flex-wrap items-center gap-1.5 duration-150">
          <Input
            type="date"
            value={query.from}
            max={query.to}
            onChange={(e) => setCustom({ from: e.target.value })}
            className="tabular h-9 w-auto"
            aria-label="From date"
          />
          <span className="text-muted text-xs">to</span>
          <Input
            type="date"
            value={query.to}
            min={query.from}
            max={isoDay()}
            onChange={(e) => setCustom({ to: e.target.value })}
            className="tabular h-9 w-auto"
            aria-label="To date"
          />
        </div>
      ) : null}
    </div>
  );
}
