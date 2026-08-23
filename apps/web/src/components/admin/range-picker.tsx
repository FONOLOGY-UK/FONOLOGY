'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AnalyticsQuery } from '@/lib/data/types';
import { isoDay, isoDaysAgo } from '@/lib/dates';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Date-range filter shared by Overview, Payments and Reports (item 7:
 * day / month / year / custom). Lives in the URL (?range=…&from=…&to=…) so a
 * view can be refreshed, shared or bookmarked without losing its window.
 */

export type RangePreset = 'today' | '30d' | '12m' | 'custom';

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '30d', label: '30 days' },
  { id: '12m', label: '12 months' },
  { id: 'custom', label: 'Custom' },
];

export function useAnalyticsRange(): {
  preset: RangePreset;
  query: AnalyticsQuery;
  setPreset: (preset: RangePreset) => void;
  setCustom: (part: { from?: string; to?: string }) => void;
} {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawPreset = searchParams.get('range');
  const preset: RangePreset =
    rawPreset === 'today' || rawPreset === '12m' || rawPreset === 'custom' ? rawPreset : '30d';

  const today = isoDay();
  const from = searchParams.get('from') ?? isoDaysAgo(29);
  const to = searchParams.get('to') ?? today;

  const query: AnalyticsQuery =
    preset === 'today'
      ? { from: today, to: today }
      : preset === '30d'
        ? { from: isoDaysAgo(29), to: today }
        : preset === '12m'
          ? { from: isoDaysAgo(364), to: today }
          : { from, to };

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
        className="border-line bg-card rounded-ui inline-flex w-fit border p-0.5"
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
