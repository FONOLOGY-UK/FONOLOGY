'use client';

import { CHART } from './theme';

/**
 * Ordered horizontal bars for magnitude comparison (category breakdown,
 * payment mix). Single hue + direct labels — clearer than a donut, no legend
 * needed. Pure HTML: crisp at any width, zero chart-lib weight.
 */
export function HBarList({
  items,
  formatValue,
}: {
  items: { key: string; label: string; value: number; sub?: string }[];
  formatValue: (value: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="grid gap-2.5">
      {items.map((item) => (
        <li key={item.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="text-ink font-semibold">
              {item.label}
              {item.sub ? <span className="text-muted ml-1.5 font-normal">{item.sub}</span> : null}
            </span>
            <span className="tabular text-ink font-bold">{formatValue(item.value)}</span>
          </div>
          <div className="bg-paper-2/80 h-2 overflow-hidden rounded-full" aria-hidden="true">
            <div
              className="h-full rounded-full transition-[width] duration-300 ease-out"
              style={{ width: `${(item.value / max) * 100}%`, background: CHART.repair }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
