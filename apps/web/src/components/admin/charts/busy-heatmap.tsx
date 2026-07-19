'use client';

import type { BusyCell } from '@/lib/data/types';
import { heatColor } from './theme';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];

/**
 * Busiest periods — weekday × hour footfall heatmap over trading hours
 * (Mon–Sat 9:00–17:00; Sunday is closed). Sequential red ramp; each cell
 * carries its exact count in the tooltip so colour is never the only reading.
 */
export function BusyHeatmap({ cells }: { cells: BusyCell[] }) {
  const lookup = new Map(cells.map((c) => [`${c.day}-${c.hour}`, c.count]));
  const max = Math.max(1, ...cells.map((c) => c.count));

  return (
    <div>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `34px repeat(${HOURS.length}, minmax(0, 1fr))` }}
      >
        <span aria-hidden="true" />
        {HOURS.map((h) => (
          <span key={h} className="text-muted tabular text-center text-[10px] font-semibold">
            {h}
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
            title={`${day} ${hour}:00 — ${count} sale${count === 1 ? '' : 's'}`}
          />
        );
      })}
    </>
  );
}
