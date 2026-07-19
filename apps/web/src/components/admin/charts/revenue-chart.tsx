'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RevenuePoint } from '@/lib/data/types';
import { formatGBP } from '@/lib/data/types';
import { CHART } from './theme';

/**
 * Revenue over time — thin stacked bars, repairs anchored to the baseline,
 * shop on top. Hover shows the full breakdown; the legend names both series
 * (identity is never colour alone).
 */
export function RevenueChart({ points }: { points: RevenuePoint[] }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-4">
        <LegendSwatch color={CHART.repair} label="Repairs" />
        <LegendSwatch color={CHART.shop} label="Shop" />
      </div>
      <ResponsiveContainer width="100%" height={264}>
        <BarChart
          data={points}
          barCategoryGap="28%"
          margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
        >
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: CHART.axis }}
            minTickGap={28}
            interval="preserveStartEnd"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: CHART.axis }}
            tickFormatter={(v: number) => formatGBP(v)}
            width={58}
          />
          <Tooltip content={<RevenueTooltip />} cursor={{ fill: 'rgba(24,16,16,0.05)' }} />
          <Bar
            dataKey="repair"
            name="Repairs"
            stackId="revenue"
            fill={CHART.repair}
            stroke={CHART.surface}
            strokeWidth={1}
          />
          <Bar
            dataKey="shop"
            name="Shop"
            stackId="revenue"
            fill={CHART.shop}
            stroke={CHART.surface}
            strokeWidth={1}
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="text-ink-2 inline-flex items-center gap-1.5 text-xs font-semibold">
      <span className="size-2.5 rounded-[3px]" style={{ background: color }} aria-hidden="true" />
      {label}
    </span>
  );
}

interface TooltipPayloadEntry {
  dataKey?: string | number;
  value?: number | string;
  payload?: RevenuePoint;
}

function RevenueTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const total = point.shop + point.repair;
  return (
    <div className="border-line bg-card shadow-card rounded-lg border p-3 text-xs">
      <p className="text-ink mb-1.5 font-bold">{point.label}</p>
      <TooltipRow color={CHART.repair} label="Repairs" value={formatGBP(point.repair)} />
      <TooltipRow color={CHART.shop} label="Shop" value={formatGBP(point.shop)} />
      <div className="border-line mt-1.5 border-t pt-1.5">
        <TooltipRow label="Total" value={formatGBP(total)} bold />
      </div>
    </div>
  );
}

function TooltipRow({
  color,
  label,
  value,
  bold,
}: {
  color?: string;
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-0.5">
      <span className="text-muted inline-flex items-center gap-1.5">
        {color ? (
          <span className="size-2 rounded-[2px]" style={{ background: color }} aria-hidden="true" />
        ) : null}
        {label}
      </span>
      <span className={`tabular text-ink ${bold ? 'font-bold' : 'font-semibold'}`}>{value}</span>
    </div>
  );
}
