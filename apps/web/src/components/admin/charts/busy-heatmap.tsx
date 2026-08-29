'use client';

import type { BusyCell } from '@/lib/data/types';
import { heatColor } from './theme';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Round 5 #8: was [9..17] — the shop's real hours run to 19:00 on weekdays
// (shop_settings.openingHours), so the chart was silently dropping the last
// two hours of trading every day. `busiest_times()` itself has never been
// hour-restricted (it groups by whatever hours actually have transactions,
// server-side) — this range was a display-only choice with no backend
// change needed to widen it. One hour of headroom past the latest close.
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/** 24h hour number -> "9am" / "12pm" / "8pm" style label. */
function hour12(h: number): string {
  const period = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${period}`;
}

/**
 * Busiest periods — weekday × hour footfall heatmap over trading hours
 * (Mon–Sat 9am–8pm; Sunday is closed). Sequential red ramp; each cell
 * carries its exact count in the tooltip so colour is never the only reading.
 */
export function BusyHeatmap({ cells }: { cells: BusyCell[] }) {
  const lookup = new Map(cells.map((c) => [`${c.day}-${c.hour}`, c.count]));
  const max = Math.max(1, ...cells.map((c) => c.count));

  const peak = cells.length > 0 ? cells.reduce((a, b) => (b.count > a.count ? b : a)) : null;

  return (
    <div>
      {/* Colour is never the only reading: cells carry exact counts in their
          tooltips, and screen readers get the headline. */}
      {peak ? (
        <p className="sr-only">
          Busiest period: {DAYS[peak.day]} at {hour12(peak.hour)} with {peak.count} sales.
        </p>
      ) : null}
      <div
        className="grid gap-1"
        aria-hidden="true"
        style={{ gridTemplateColumns: `34px repeat(${HOURS.length}, minmax(0, 1fr))` }}
      >
        <span aria-hidden="true" />
        {HOURS.map((h) => (
          <span key={h} className="text-muted tabular text-center text-[10px] font-semibold">
            {hour12(h)}
          </span>
        ))}
        {DAYS.map((day, di) => (
          <DayRow key={day} day={day} dayIndex={di} lookup={lookup} max={max} />
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
  lookup,
  max,
}: {
  day: string;
  dayIndex: number;
  lookup: Map<string, number>;
  max: number;
}) {
  return (
    <>
      <span className="text-muted self-center text-[11px] font-semibold">{day}</span>
      {HOURS.map((hour) => {
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
