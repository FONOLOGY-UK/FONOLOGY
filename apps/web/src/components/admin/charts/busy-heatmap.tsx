'use client';

import type { BusyCell } from '@/lib/data/types';
import { heatColor } from './theme';

// busiest_times() numbers days Monday = 0 … Sunday = 6.
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** The days always shown: the shop trades Mon–Sat. */
const TRADING_DAYS = 6;
// Round 5 #8: was [9..17] — the shop's real hours run to 19:00 on weekdays
// (shop_settings.openingHours), so the chart was silently dropping the last
// two hours of trading every day. `busiest_times()` itself has never been
// hour-restricted (it groups by whatever hours actually have transactions,
// server-side) — this range was a display-only choice with no backend
// change needed to widen it. One hour of headroom past the latest close.
const TRADING_HOURS = { first: 9, last: 20 };

/** 24h hour number -> "9am" / "12pm" / "8pm" style label. */
function hour12(h: number): string {
  const period = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${period}`;
}

/**
 * Busiest periods — weekday × hour footfall heatmap over trading hours
 * (Mon–Sat 9am–8pm). Sequential red ramp; each cell carries its exact count
 * in the tooltip so colour is never the only reading.
 *
 * The grid grows to fit the data: a sale on a Sunday, or before 9am / after
 * 8pm, adds that row or those columns rather than vanishing. A fixed grid used
 * to drop them silently while the headline still picked them as the peak —
 * which then read "Busiest period: at 7am", with no day, because there was no
 * Sunday label to name it by.
 */
export function BusyHeatmap({ cells }: { cells: BusyCell[] }) {
  const lookup = new Map(cells.map((c) => [`${c.day}-${c.hour}`, c.count]));
  const max = Math.max(1, ...cells.map((c) => c.count));

  const withSales = cells.filter((c) => c.count > 0);
  const days = DAY_NAMES.slice(0, withSales.some((c) => c.day === 6) ? 7 : TRADING_DAYS);
  const first = Math.min(TRADING_HOURS.first, ...withSales.map((c) => c.hour));
  const last = Math.max(TRADING_HOURS.last, ...withSales.map((c) => c.hour));
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);

  const peak = cells.length > 0 ? cells.reduce((a, b) => (b.count > a.count ? b : a)) : null;

  return (
    <div>
      {/* Colour is never the only reading: cells carry exact counts in their
          tooltips, and screen readers get the headline. */}
      {peak ? (
        <p className="sr-only">
          Busiest period: {DAY_NAMES[peak.day]} at {hour12(peak.hour)} with {peak.count} sales.
        </p>
      ) : null}
      <div
        className="grid gap-1"
        aria-hidden="true"
        style={{ gridTemplateColumns: `34px repeat(${hours.length}, minmax(0, 1fr))` }}
      >
        <span aria-hidden="true" />
        {hours.map((h) => (
          <span key={h} className="text-muted tabular text-center text-[10px] font-semibold">
            {hour12(h)}
          </span>
        ))}
        {days.map((day, di) => (
          <DayRow key={day} day={day} dayIndex={di} hours={hours} lookup={lookup} max={max} />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-muted text-[11px]">Quiet</span>
        <div
          className="h-1.5 w-24 rounded-full"
          style={{
            background: `linear-gradient(to right, ${heatColor(0)}, ${heatColor(1)})`,
          }}
          aria-hidden="true"
        />
        <span className="text-muted text-[11px]">Busy</span>
      </div>
    </div>
  );
}

function DayRow({
  day,
  dayIndex,
  hours,
  lookup,
  max,
}: {
  day: string;
  dayIndex: number;
  hours: number[];
  lookup: Map<string, number>;
  max: number;
}) {
  return (
    <>
      <span className="text-muted self-center text-[11px] font-semibold">{day}</span>
      {hours.map((hour) => {
        const count = lookup.get(`${dayIndex}-${hour}`) ?? 0;
        return (
          <div
            key={hour}
            className="ring-line aspect-square min-h-[18px] rounded-[5px] transition-shadow hover:ring-2"
            style={{ background: count === 0 ? 'var(--paper-2)' : heatColor(count / max) }}
            title={`${day} ${hour12(hour)} — ${count} sale${count === 1 ? '' : 's'}`}
          />
        );
      })}
    </>
  );
}
