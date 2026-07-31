'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Lock, ShieldAlert } from 'lucide-react';
import {
  useCreateDayClose,
  useDayCloses,
  useSession,
  useShopDay,
  useTodayReport,
} from '@/lib/data/hooks';
import { useStaffPermissions, useStaffRole } from '@/components/shared/can';
import { can } from '@/lib/permissions.config';
import type { DayClose, DayCloseBreakdown } from '@/lib/data/types';
import { formatGBP, pounds, tenderLabel } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/admin/field';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';

/**
 * End-of-day cash up (Phase 2.1).
 *
 * The count is BLIND. Before the drawer is counted this screen shows the
 * operator nothing but an input — no expected figure, no breakdown, no hint.
 * Someone who is £20 short and can see the target will recount until they
 * land near it, so a count that already knows the answer isn't a count. The
 * expected figure and the full breakdown appear the moment the count is
 * committed and can no longer be influenced.
 *
 * Nothing here computes money. `expectedAmount`, `variance` and every
 * breakdown term come from the server, which owns the formula — including
 * subtracting cash paid out for trade-ins, the term whose absence makes every
 * close look short by exactly the amount paid out.
 */

const formSchema = z.object({
  counted: z
    .string()
    .trim()
    .min(1, 'Enter the counted amount')
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Enter an amount like 152.40')
    .refine((v) => Number(v) <= 1_000_000, 'That looks too large — check the figure'),
  note: z.string().trim().max(500).optional(),
});
type FormValues = z.infer<typeof formSchema>;

export function DayCloseView() {
  const role = useStaffRole('owner');
  const permissions = useStaffPermissions();
  const { isPending: sessionPending } = useSession();

  // Wait for the real per-person set before deciding, or this flashes a
  // refusal at someone who does hold cash.manage.
  if (sessionPending) return null;
  if (!can(role, 'cash.manage', permissions)) {
    return (
      <div className="border-line bg-card mx-auto mt-10 max-w-sm rounded-lg border p-8 text-center">
        <ShieldAlert className="text-muted mx-auto mb-3 size-6" aria-hidden="true" />
        <p className="font-display text-ink text-lg font-extrabold uppercase">No access</p>
        <p className="text-muted mt-1 text-sm">
          Closing the till needs the cash permission. Ask the owner if you need it.
        </p>
      </div>
    );
  }

  return <DayCloseScreen />;
}

function DayCloseScreen() {
  // The trading day comes from the server (Europe/London). Deriving it from
  // the browser clock gets "is today closed?" wrong whenever the two
  // disagree — a machine past local midnight while the shop day is still
  // yesterday would show the count form for a day already closed.
  const { data: today } = useShopDay();
  const { data: closes, isPending, isError, refetch } = useDayCloses();
  const createClose = useCreateDayClose();
  const [justClosed, setJustClosed] = useState<DayClose | null>(null);

  const todaysClose = useMemo(() => closes?.find((c) => c.date === today) ?? null, [closes, today]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { counted: '', note: '' },
  });

  // Shown after closing: the row this session just created, or — if the day
  // was already closed before this screen opened — the existing record.
  const settled = justClosed ?? todaysClose;

  // Until the server has said which trading day it is, showing the count form
  // would risk offering a close for a day that is already closed.
  const dayKnown = Boolean(today);

  async function onSubmit(values: FormValues) {
    try {
      const close = await createClose.mutateAsync({
        countedAmount: pounds(Number(values.counted)),
        note: values.note?.trim() ? values.note.trim() : undefined,
      });
      setJustClosed(close);
      form.reset();
    } catch (error) {
      // "Already closed" is a normal outcome, not a failure state — someone
      // else may have closed the till, or this tab was left open. Surfaced on
      // the field rather than as an alarm.
      const message = error instanceof Error ? error.message : 'Could not record the close.';
      form.setError('counted', { message });
      void refetch();
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Cash"
        title="Close the day"
        description="Count the drawer, then record it. The expected figure is shown once the count is in."
      />

      {isError ? (
        <div className="bg-card border-line rounded-lg border p-6">
          <p className="text-muted text-sm">Could not load the day-close history.</p>
          <Button className="mt-3" variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : null}

      {settled ? (
        <ClosedPanel close={settled} isToday={settled.date === today} />
      ) : !dayKnown ? (
        <section className="bg-card border-line rounded-lg border p-6">
          <p className="text-muted text-sm">Checking today’s till…</p>
        </section>
      ) : (
        <section className="bg-card border-line rounded-lg border p-6">
          <div className="flex items-start gap-3">
            <Lock className="text-muted mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p className="text-muted max-w-prose text-sm">
              Count the drawer and enter the total. The expected figure stays hidden until the count
              is recorded — so the count is a count, not a check against a target.
            </p>
          </div>

          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="mt-5 flex max-w-md flex-col gap-4"
            noValidate
          >
            <Field
              label="Counted cash"
              htmlFor="counted"
              error={form.formState.errors.counted?.message}
              hint="Everything physically in the drawer, in pounds."
            >
              <Input
                id="counted"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                disabled={isPending || createClose.isPending}
                {...form.register('counted')}
              />
            </Field>

            <Field
              label="Note (optional)"
              htmlFor="note"
              error={form.formState.errors.note?.message}
              hint="Anything worth remembering about today's drawer."
            >
              <Input
                id="note"
                autoComplete="off"
                placeholder="e.g. £5 float note taken for parking"
                disabled={createClose.isPending}
                {...form.register('note')}
              />
            </Field>

            <div>
              <Button type="submit" disabled={isPending || createClose.isPending}>
                {createClose.isPending ? 'Recording…' : 'Record the count'}
              </Button>
            </div>
          </form>
        </section>
      )}

      <History closes={closes} isPending={isPending} today={today} />
    </>
  );
}

/** The result of a close: expected, counted, variance, and how it was reached. */
function ClosedPanel({ close, isToday }: { close: DayClose; isToday: boolean }) {
  return (
    <section className="bg-card border-line rounded-lg border p-6">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <h2 className="font-display text-ink text-lg font-extrabold uppercase leading-none tracking-tight">
            {isToday ? 'Today is closed' : `${close.date} is closed`}
          </h2>
          <p className="text-muted mt-1 text-sm">
            Recorded {formatDateTime(close.at)}. One close per trading day.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Figure label="Expected" value={close.expectedAmount} />
        <Figure label="Counted" value={close.countedAmount} />
        <Figure label="Difference" value={close.variance} showSign />
      </div>

      <p className="text-muted mt-3 text-xs">
        The difference is recorded as it stands. Most differences are a miscount or petty cash that
        never made it into the book.
      </p>

      {close.note ? (
        <p className="text-ink border-line mt-4 border-t pt-4 text-sm">
          <span className="text-muted text-[11px] font-semibold uppercase tracking-[0.14em]">
            Note
          </span>
          <br />
          {close.note}
        </p>
      ) : null}

      {close.breakdown ? (
        <Breakdown breakdown={close.breakdown} expected={close.expectedAmount} />
      ) : (
        <p className="text-muted border-line mt-4 border-t pt-4 text-xs">
          No breakdown was stored for this close — it predates the breakdown being recorded.
        </p>
      )}

      {isToday ? <TenderSplit /> : null}
    </section>
  );
}

/**
 * How today's takings split across tenders — the cash-versus-card view staff
 * asked for when reconciling the drawer.
 *
 * Two deliberate choices:
 *
 * It reads `GET /pos/today/report`, gated on `sales.today`, which the employee
 * template already holds. It does NOT use the transactions ledger, which is
 * gated on `payments.view` — that permission also opens the full payments
 * report and every historical transaction, which is a different thing from
 * "how did today split" and is not what was asked for. No permission needed
 * widening to build this.
 *
 * And it renders only AFTER the day is closed. Cash takings are a term in the
 * expected figure, so showing them beside an uncounted drawer hands the
 * operator the answer — which is the whole thing the blind count exists to
 * prevent, and why the client-side expected calculation was deleted from
 * /admin/cash earlier. Once the count is committed nothing can be influenced,
 * so the split is safe and useful here.
 */
function TenderSplit() {
  const { data, isPending, isError } = useTodayReport();

  if (isPending || isError || !data || data.byTender.length === 0) return null;

  const total = data.byTender.reduce((sum, t) => sum + t.total, 0);

  return (
    <div className="border-line mt-4 border-t pt-4">
      <p className="text-muted text-[11px] font-semibold uppercase tracking-[0.14em]">
        Today’s takings by tender
      </p>
      <dl className="mt-2 grid gap-1.5">
        {[...data.byTender]
          .sort((a, b) => b.total - a.total)
          .map((t) => (
            <div
              key={t.tender ?? 'mixed'}
              className="bg-paper-2/60 flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px]"
            >
              <dt className="text-ink-2 font-semibold">{tenderLabel(t.tender)}</dt>
              <dd className="text-ink tabular font-bold">
                {formatGBP(t.total, { alwaysShowPennies: true })}
                <span className="text-muted ml-2 font-normal">
                  {t.count} {t.count === 1 ? 'payment' : 'payments'}
                </span>
              </dd>
            </div>
          ))}
      </dl>
      <p className="text-muted mt-2 text-xs">
        Takings only — {formatGBP(total, { alwaysShowPennies: true })} across all tenders. Only the
        cash line touches the drawer; card and transfer never do.
      </p>
    </div>
  );
}

function Figure({
  label,
  value,
  showSign = false,
}: {
  label: string;
  value: number;
  showSign?: boolean;
}) {
  // A negative expected figure is a real trading day — a big cash payout with
  // few cash sales — not an error. It renders as a plain negative number.
  const text = formatGBP(value, { alwaysShowPennies: true });
  return (
    <div className="border-line rounded-lg border p-4">
      <p className="text-muted text-[11px] font-semibold uppercase tracking-[0.14em]">{label}</p>
      <p className="font-display text-ink tabular mt-1 text-[28px] font-extrabold leading-none tracking-tight">
        {showSign && value > 0 ? `+${text}` : text}
      </p>
    </div>
  );
}

/** How the server reached the expected figure. Signs shown, never re-derived. */
function Breakdown({ breakdown, expected }: { breakdown: DayCloseBreakdown; expected: number }) {
  const rows: { label: string; value: number; sign: '+' | '−' }[] = [
    { label: 'Opening float', value: breakdown.floatOpen, sign: '+' },
    { label: 'Petty cash in', value: breakdown.pettyIn, sign: '+' },
    { label: 'Petty cash out', value: breakdown.pettyOut, sign: '−' },
    { label: 'Cash sales', value: breakdown.cashSales, sign: '+' },
    { label: 'Cash refunds', value: breakdown.cashRefunds, sign: '−' },
    { label: 'Cash paid out for trade-ins', value: breakdown.cashPayouts, sign: '−' },
  ];

  return (
    <div className="border-line mt-4 border-t pt-4">
      <p className="text-muted text-[11px] font-semibold uppercase tracking-[0.14em]">
        How the expected figure was reached
      </p>
      <dl className="mt-3 flex flex-col gap-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4 text-sm">
            <dt className="text-muted">
              <span className="text-ink/40 mr-1.5 font-semibold">{row.sign}</span>
              {row.label}
            </dt>
            <dd className="text-ink tabular font-medium">
              {formatGBP(row.value, { alwaysShowPennies: true })}
            </dd>
          </div>
        ))}
        <div className="border-line mt-1.5 flex items-baseline justify-between gap-4 border-t pt-2 text-sm">
          <dt className="text-ink font-semibold">Expected in the drawer</dt>
          <dd className="text-ink tabular font-bold">
            {formatGBP(expected, { alwaysShowPennies: true })}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function History({
  closes,
  isPending,
  today,
}: {
  closes: DayClose[] | undefined;
  isPending: boolean;
  today: string | undefined;
}) {
  const [openRow, setOpenRow] = useState<string | null>(null);

  const past = useMemo(() => closes?.filter((c) => c.date !== today) ?? [], [closes, today]);

  const columns: ColumnDef<DayClose, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'date',
        header: 'Trading day',
        cell: ({ row }) => <span className="tabular font-medium">{row.original.date}</span>,
      },
      {
        accessorKey: 'expectedAmount',
        header: 'Expected',
        cell: ({ row }) => (
          <span className="tabular">
            {formatGBP(row.original.expectedAmount, { alwaysShowPennies: true })}
          </span>
        ),
      },
      {
        accessorKey: 'countedAmount',
        header: 'Counted',
        cell: ({ row }) => (
          <span className="tabular">
            {formatGBP(row.original.countedAmount, { alwaysShowPennies: true })}
          </span>
        ),
      },
      {
        accessorKey: 'variance',
        header: 'Difference',
        cell: ({ row }) => {
          const v = row.original.variance;
          const text = formatGBP(v, { alwaysShowPennies: true });
          return <span className="tabular">{v > 0 ? `+${text}` : text}</span>;
        },
      },
      {
        id: 'breakdown',
        header: '',
        cell: ({ row }) =>
          row.original.breakdown ? (
            <button
              type="button"
              onClick={() => setOpenRow(openRow === row.original.id ? null : row.original.id)}
              className="text-muted hover:text-ink text-xs underline underline-offset-2"
            >
              {openRow === row.original.id ? 'Hide breakdown' : 'Breakdown'}
            </button>
          ) : (
            <span className="text-muted/60 text-xs">Not recorded</span>
          ),
      },
    ],
    [openRow],
  );

  const opened = past.find((c) => c.id === openRow);

  return (
    <section className="mt-8">
      <h2 className="font-display text-ink mb-3 text-lg font-extrabold uppercase leading-none tracking-tight">
        Previous closes
      </h2>
      <DataTable
        data={past}
        columns={columns}
        isLoading={isPending}
        isError={false}
        searchable={false}
        empty={{
          title: 'No previous closes',
          description: 'Once a trading day is closed it will be listed here with its breakdown.',
        }}
      />
      {opened?.breakdown ? (
        <div className="bg-card border-line mt-3 rounded-lg border p-5">
          <p className="text-ink text-sm font-semibold">{opened.date}</p>
          <Breakdown breakdown={opened.breakdown} expected={opened.expectedAmount} />
        </div>
      ) : null}
    </section>
  );
}
