'use client';

import { useEffect, useState } from 'react';
import { useSettings, useUpdateSettings } from '@/lib/data/hooks';
import { formatGBP, pounds } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Field } from '@/components/admin/field';
import { PageHeader } from '@/components/admin/page-header';
import { PinChangeCard } from '@/components/shared/pin-change-card';

/**
 * Item 5 — turn the six text boxes into a settings patch.
 *
 * Blank becomes null (clear the limit), a number becomes pence. An
 * unparseable value is skipped rather than sent as 0, because silently
 * turning a typo into "this machine takes nothing" would stop the shop
 * taking card payments and look like a system fault.
 */
function cardLimitPatch(values: Record<string, string>): Record<string, number | null> {
  const patch: Record<string, number | null> = {};
  for (const key of [
    'card1DailyLimit',
    'card1WeeklyLimit',
    'card1MonthlyLimit',
    'card2DailyLimit',
    'card2WeeklyLimit',
    'card2MonthlyLimit',
  ]) {
    const raw = (values[key] ?? '').trim();
    if (raw === '') {
      patch[key] = null;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    patch[key] = pounds(n);
  }
  return patch;
}

/**
 * Settings (item 7): the handful of dials the owner actually turns — return
 * window, float target, idle lock, and the screen-lock PIN. Flat on purpose;
 * anything else belongs to its own module. (Low-stock alerting moved to the
 * product itself — see the note in the Shop card.)
 */
export function SettingsView() {
  const { data: settings, isPending, isError, refetch } = useSettings();
  const updateSettings = useUpdateSettings();

  const [returnWindow, setReturnWindow] = useState('');
  const [idleMinutes, setIdleMinutes] = useState('');
  const [floatPounds, setFloatPounds] = useState('');
  /**
   * Change request item 5 — the six card limits, held as strings because an
   * EMPTY string is a meaningful value here: it means "no limit", and it has
   * to be distinguishable from "0", which means this machine takes nothing.
   * A number-or-null state would lose that distinction at the input.
   */
  const [cardLimits, setCardLimits] = useState<Record<string, string>>({});

  // Seed the form when settings arrive.
  useEffect(() => {
    if (!settings) return;
    setReturnWindow(`${settings.returnWindowDays}`);
    setIdleMinutes(`${settings.idleLockMinutes}`);
    setFloatPounds((settings.floatTarget / 100).toFixed(2));
    const asPounds = (v: number | null) => (v === null ? '' : (v / 100).toFixed(2));
    setCardLimits({
      card1DailyLimit: asPounds(settings.card1DailyLimit),
      card1WeeklyLimit: asPounds(settings.card1WeeklyLimit),
      card1MonthlyLimit: asPounds(settings.card1MonthlyLimit),
      card2DailyLimit: asPounds(settings.card2DailyLimit),
      card2WeeklyLimit: asPounds(settings.card2WeeklyLimit),
      card2MonthlyLimit: asPounds(settings.card2MonthlyLimit),
    });
  }, [settings]);

  const saveShop = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings.mutate({
      returnWindowDays: Math.max(0, Math.round(Number(returnWindow) || 0)),
      idleLockMinutes: Math.max(1, Math.round(Number(idleMinutes) || 1)),
      floatTarget: pounds(Number(floatPounds) || 0),
      // Item 5. Blank sends null, which CLEARS the limit — it is not the
      // same as omitting the field (leave it alone) or as 0 (this machine
      // takes nothing). All three are reachable and all three mean something
      // different.
      ...cardLimitPatch(cardLimits),
    });
  };

  if (isError) {
    return (
      <div>
        <PageHeader eyebrow="Team" title="Settings" />
        <div className="border-line bg-card rounded-lg border p-8 text-center">
          <p className="text-ink mb-3 text-sm font-semibold">Settings didn’t load.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Team"
        title="Settings"
        description="The dials that change how the shop runs."
      />

      {isPending || !settings ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[320px]" />
          <Skeleton className="h-[320px]" />
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {/* Shop dials */}
          <form
            onSubmit={saveShop}
            className="border-line bg-card grid gap-4 rounded-lg border p-5"
          >
            <h2 className="font-display text-ink text-sm font-extrabold uppercase tracking-[0.06em]">
              Shop
            </h2>
            <Field
              label="Return window (days)"
              htmlFor="set-window"
              hint="Refunds outside this need an admin override — reason kept on record"
            >
              <Input
                id="set-window"
                type="number"
                min="0"
                step="1"
                className="tabular"
                value={returnWindow}
                onChange={(e) => setReturnWindow(e.target.value)}
              />
            </Field>
            <p className="border-line bg-paper-2/40 rounded-ui text-muted border px-3 py-2.5 text-xs">
              <strong className="text-ink">Low-stock alerts are set per product.</strong> Open a
              product in Inventory to switch its warning on and choose the count to warn at — a
              cable that sells daily and a plate that sells monthly need different rules.
            </p>
            <Field
              label="Opening float target (£)"
              htmlFor="set-float"
              hint={`Pre-filled in the morning float prompt — currently ${formatGBP(settings.floatTarget)}`}
            >
              <Input
                id="set-float"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="tabular"
                value={floatPounds}
                onChange={(e) => setFloatPounds(e.target.value)}
              />
            </Field>
            <Field
              label="Idle lock (minutes)"
              htmlFor="set-idle"
              hint="The dashboard locks itself after this long untouched"
            >
              <Input
                id="set-idle"
                type="number"
                min="1"
                step="1"
                className="tabular"
                value={idleMinutes}
                onChange={(e) => setIdleMinutes(e.target.value)}
              />
            </Field>
            {/*
              Change request item 5 — card machine limits.

              A HARD block: a card payment that would go past one of these is
              refused, at the till before the card is ever run and again by
              the database if anything tries to write it anyway. That makes
              these numbers operationally sharp, so the copy says so plainly
              rather than calling them "limits" and leaving staff to discover
              what happens at the counter.

              Blank is no limit. Every one is independent — a monthly limit
              on Card 2 alone is a perfectly normal configuration.
            */}
            <div className="border-line rounded-ui border p-3">
              <p className="text-ink text-sm font-bold">Card machine limits</p>
              <p className="text-muted mb-3 text-xs">
                Leave any of these blank for no limit. A payment that would take a machine past one
                of its limits is <strong>refused at the till</strong> — staff are told before the
                card is run, so nothing gets charged and then rejected. Repair payments count
                towards the same figures; refunds don’t give headroom back.
              </p>
              {(['card1', 'card2'] as const).map((card) => (
                <div key={card} className="mb-3 last:mb-0">
                  <p className="text-muted mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em]">
                    {card === 'card1' ? 'Card 1' : 'Card 2'}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(
                      [
                        ['Daily', 'Daily'],
                        ['Weekly', 'Weekly (Mon–Sun)'],
                        ['Monthly', 'Monthly'],
                      ] as const
                    ).map(([period, label]) => {
                      const key = `${card}${period}Limit`;
                      return (
                        <Field key={key} label={`${label} (£)`} htmlFor={`set-${key}`}>
                          <Input
                            id={`set-${key}`}
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            className="tabular"
                            placeholder="No limit"
                            value={cardLimits[key] ?? ''}
                            onChange={(e) =>
                              setCardLimits((cur) => ({ ...cur, [key]: e.target.value }))
                            }
                          />
                        </Field>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={updateSettings.isPending}>
                {updateSettings.isPending ? 'Saving…' : 'Save shop settings'}
              </Button>
            </div>
          </form>

          {/* PIN */}
          <PinChangeCard />
        </div>
      )}
    </div>
  );
}
