'use client';

import { useMemo, useState, useDeferredValue } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { Banknote, Lock, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useCancelScheduledPettyCash,
  useCashEntriesPage,
  useCreateCashEntry,
  useDayClosesPage,
  usePettyCash,
  useScheduledPettyCash,
  useSchedulePettyCash,
  useSession,
  useSettings,
  useShopDay,
} from '@/lib/data/hooks';
import type { CashEntry, CashEntryKind, DayClose } from '@/lib/data/types';
import { cashEntryKindLabel, formatGBP, pounds } from '@/lib/data/types';
import { formatDateTime, isoDay } from '@/lib/dates';
import { can } from '@/lib/permissions.config';
import { useStaffPermissions, useStaffRole } from '@/components/shared/can';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/admin/field';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { StatTile } from '@/components/admin/stat-tile';
import { StatusChip, type ChipTone } from '@/components/admin/status-chip';
import { cn } from '@/lib/utils';

/**
 * Float & petty cash (item 7). A log of drawer movements — what was put in
 * and taken out — kept apart from sales revenue.
 *
 * This screen deliberately shows NO expected-drawer figure. It used to
 * compute one in the browser, which was wrong twice over: it left out cash
 * refunds and cash trade-in payouts (so it read about £190 on a day the
 * server put at −£372), and it handed the till operator a target to count
 * towards, defeating the blind count on the day-close screen one click away.
 * The server owns that figure and only reveals it once the count is
 * committed — see day-close-view.tsx. Once the day IS closed the committed
 * figures are shown below, because by then nothing can be influenced.
 */
const HISTORY_PAGE_SIZE = 10;

type CashRange = 'today' | 'yesterday' | '7d' | 'custom';

const CASH_RANGES: { id: CashRange; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: 'custom', label: 'Custom' },
];

function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `dateFilters`: the Admin panel's view of other days. The till always shows today only. */
export function CashView({ dateFilters = false }: { dateFilters?: boolean }) {
  // The trading day is the server's (Europe/London), never the browser clock.
  const { data: today } = useShopDay();
  // Today's few entries drive the panel above; the history below is paged and searched by the server.
  const todayPage = useCashEntriesPage(
    { date: today ?? undefined, limit: 100, offset: 0 },
    !!today,
  );
  const role = useStaffRole('employee');
  const permissions = useStaffPermissions();
  // The API returns today only to anyone without reports.view, so offering them the filters would lie.
  const showFilters = dateFilters && can(role, 'reports.view', permissions);
  const [range, setRange] = useState<CashRange>('today');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [pageIndex, setPageIndex] = useState(0);
  const dates = useMemo(() => {
    if (!today) return null;
    if (!showFilters || range === 'today') return { from: today, to: today };
    if (range === 'yesterday') {
      const day = shiftDay(today, -1);
      return { from: day, to: day };
    }
    if (range === '7d') return { from: shiftDay(today, -6), to: today };
    return custom ?? { from: shiftDay(today, -6), to: today };
  }, [today, showFilters, range, custom]);
  const history = useCashEntriesPage(
    {
      from: dates?.from,
      to: dates?.to,
      search: deferredSearch || undefined,
      limit: HISTORY_PAGE_SIZE,
      offset: pageIndex * HISTORY_PAGE_SIZE,
    },
    !!dates,
  );
  const { isError, refetch } = history;
  const isPending = history.isPending || (!!today && todayPage.isPending);
  const { data: latestClose } = useDayClosesPage({ limit: 1, offset: 0 });
  const closes = latestClose?.items;
  const [recording, setRecording] = useState(false);
  // Client changes, Oct 2026 #7: petty cash is its own pot with a running balance (0121).
  const { data: petty, isPending: pettyPending } = usePettyCash();
  const pettySeparate = petty?.separate === true;

  const todayEntries = useMemo(
    () => (today ? (todayPage.data?.items ?? []) : []),
    [todayPage.data, today],
  );
  const float = todayEntries.find((e) => e.kind === 'float-open');
  const pettyIn = todayEntries
    .filter((e) => e.kind === 'petty-in')
    .reduce((s, e) => s + e.amount, 0);
  const pettyOut = todayEntries
    .filter((e) => e.kind === 'petty-out')
    .reduce((s, e) => s + e.amount, 0);

  const todaysClose = useMemo(
    () => (today ? (closes?.find((c) => c.date === today) ?? null) : null),
    [closes, today],
  );

  /** Resolved server-side from the session-stamped staff id. */
  const recordedBy = (entry: CashEntry) => entry.staffName ?? '—';

  const columns = useMemo<ColumnDef<CashEntry>[]>(() => {
    const tone: Record<CashEntryKind, ChipTone> = {
      'float-open': 'ink',
      'petty-in': 'success',
      'petty-out': 'warning',
    };
    return [
      {
        accessorKey: 'at',
        header: 'When',
        cell: ({ getValue }) => (
          <span className="text-muted tabular">{formatDateTime(getValue<string>())}</span>
        ),
      },
      {
        accessorKey: 'kind',
        header: 'Entry',
        cell: ({ row }) => (
          <StatusChip tone={tone[row.original.kind]}>
            {cashEntryKindLabel(row.original.kind)}
          </StatusChip>
        ),
      },
      {
        accessorKey: 'amount',
        header: 'Amount',
        cell: ({ row }) => {
          const out = row.original.kind === 'petty-out';
          return (
            <span className={cn('tabular font-bold', out ? 'text-red-deep' : 'text-ink')}>
              {out ? '−' : '+'}
              {formatGBP(row.original.amount)}
            </span>
          );
        },
      },
      { accessorKey: 'note', header: 'Note' },
      {
        id: 'by',
        header: 'By',
        cell: ({ row }) => <span className="text-muted">{recordedBy(row.original)}</span>,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Cash drawer"
        description={
          pettySeparate
            ? 'The opening float, and petty cash — its own tin, apart from the drawer and the takings. Petty cash carries over from day to day and starts again at £0 every Monday.'
            : 'Float and petty cash — kept apart from sales revenue.'
        }
        actions={
          <Button onClick={() => setRecording(true)}>
            <Plus aria-hidden="true" />
            Record entry
          </Button>
        }
      />

      <div className={cn('mb-6 grid gap-3', pettySeparate ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
        <StatTile
          label="Opening float"
          value={float ? formatGBP(float.amount) : 'Not set'}
          sub={float ? `by ${recordedBy(float)}` : 'record it below'}
          isLoading={isPending}
        />
        {petty?.separate ? (
          <StatTile
            label="Petty cash in the tin"
            value={formatGBP(petty.balance)}
            sub={`opened at ${formatGBP(petty.opening)} · back to £0 on Monday`}
            isLoading={pettyPending}
          />
        ) : null}
        <StatTile
          label="Petty cash in today"
          value={formatGBP(pettyIn)}
          sub={`${todayEntries.filter((e) => e.kind === 'petty-in').length} entries`}
          isLoading={isPending}
        />
        <StatTile
          label="Petty cash out today"
          value={formatGBP(pettyOut)}
          sub={`${todayEntries.filter((e) => e.kind === 'petty-out').length} entries`}
          isLoading={isPending}
        />
      </div>

      {todaysClose ? (
        <ClosedToday close={todaysClose} />
      ) : (
        <div className="border-line bg-card text-muted mb-4 flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Today hasn’t been closed yet. The expected drawer figure is worked out by the server and
            shown on{' '}
            <Link href="/admin/day-close" className="text-ink underline underline-offset-2">
              Close the day
            </Link>{' '}
            — after the count is recorded, so the count isn’t aimed at a target.
          </p>
        </div>
      )}

      {!isPending && !float ? (
        <div className="border-line bg-blush text-ink-2 mb-4 flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm">
          <Banknote className="text-red-deep size-4 shrink-0" aria-hidden="true" />
          <p>
            <strong>No opening float recorded today.</strong> Record it before trading — the server
            needs it to reconcile the drawer when the day is closed.
          </p>
        </div>
      ) : null}

      {showFilters && today ? <ScheduledPettyCash today={today} /> : null}

      {showFilters && dates ? (
        <div className="mb-3 grid gap-2">
          <div
            className="border-line bg-card rounded-ui flex w-fit flex-wrap gap-0.5 border p-0.5"
            role="group"
            aria-label="Cash history dates"
          >
            {CASH_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={range === r.id}
                onClick={() => {
                  if (r.id === 'custom' && !custom) setCustom(dates);
                  setRange(r.id);
                  setPageIndex(0);
                }}
                className={cn(
                  'rounded-[10px] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.04em] transition-colors duration-150',
                  range === r.id ? 'bg-ink text-bone' : 'text-muted hover:text-ink',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          {range === 'custom' ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Input
                type="date"
                value={dates.from}
                max={dates.to}
                onChange={(e) => {
                  if (e.target.value) setCustom({ from: e.target.value, to: dates.to });
                  setPageIndex(0);
                }}
                className="tabular h-9 w-auto"
                aria-label="From date"
              />
              <span className="text-muted text-xs">to</span>
              <Input
                type="date"
                value={dates.to}
                min={dates.from}
                max={today ?? undefined}
                onChange={(e) => {
                  if (e.target.value) setCustom({ from: dates.from, to: e.target.value });
                  setPageIndex(0);
                }}
                className="tabular h-9 w-auto"
                aria-label="To date"
              />
            </div>
          ) : null}
          {history.data ? (
            <p className="text-muted tabular text-xs">
              Floats {formatGBP(history.data.totals.floatOpen)} · Petty cash in{' '}
              {formatGBP(history.data.totals.pettyIn)} · Petty cash out{' '}
              {formatGBP(history.data.totals.pettyOut)}
            </p>
          ) : null}
        </div>
      ) : null}

      <DataTable
        data={history.data?.items}
        server={{
          total: history.data?.total ?? 0,
          pageIndex,
          onPageChange: setPageIndex,
        }}
        search={search}
        onSearchChange={setSearch}
        columns={columns}
        isLoading={isPending}
        isError={isError}
        errorMessage="The cash history didn’t load."
        onRetry={() => refetch()}
        searchPlaceholder="Search notes…"
        pageSize={HISTORY_PAGE_SIZE}
        empty={
          showFilters
            ? {
                title: 'No cash entries for these dates',
                description: 'Try a wider date range.',
              }
            : {
                title: 'No cash entries today',
                description: 'Today’s opening float and petty cash will show here.',
              }
        }
      />

      <CashEntryDialog
        open={recording}
        onOpenChange={setRecording}
        floatRecorded={!!float}
        pettyBalance={petty?.separate ? petty.balance : null}
      />
    </div>
  );
}

/**
 * Today's committed close. Safe to show here: the count is already recorded,
 * so these figures can't influence it.
 */
function ClosedToday({ close }: { close: DayClose }) {
  return (
    <div className="border-line bg-card mb-4 rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-ink text-sm font-semibold">Today is closed</p>
        <Link
          href="/admin/day-close"
          className="text-muted hover:text-ink text-xs underline underline-offset-2"
        >
          Full breakdown
        </Link>
      </div>
      <dl className="text-muted mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-2">
          <dt>Expected</dt>
          <dd className="text-ink tabular font-medium">
            {formatGBP(close.expectedAmount, { alwaysShowPennies: true })}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt>Counted</dt>
          <dd className="text-ink tabular font-medium">
            {formatGBP(close.countedAmount, { alwaysShowPennies: true })}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt>Difference</dt>
          <dd
            className={`${close.varianceFlagged ? 'text-warning font-semibold' : 'text-ink font-medium'} tabular`}
            title={close.varianceFlagged ? 'Short by more than £10' : undefined}
          >
            {close.variance > 0 ? '+' : ''}
            {formatGBP(close.variance, { alwaysShowPennies: true })}
          </dd>
        </div>
      </dl>
      {close.pettyCash ? (
        <dl className="text-muted mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-2">
            <dt>Petty cash counted</dt>
            <dd className="text-ink tabular font-medium">
              {formatGBP(close.pettyCash.counted, { alwaysShowPennies: true })}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt>Petty difference</dt>
            <dd className="text-ink tabular font-medium">
              {close.pettyCash.variance > 0 ? '+' : ''}
              {formatGBP(close.pettyCash.variance, { alwaysShowPennies: true })}
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

/* ---- Petty Cash In booked ahead (0128) -------------------------------------- */

function ScheduledPettyCash({ today }: { today: string }) {
  const { data: scheduled } = useScheduledPettyCash();
  const schedule = useSchedulePettyCash();
  const cancel = useCancelScheduledPettyCash();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!date || date <= today) return setError('Choose a date after today.');
    const n = Number(amount);
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) return setError('Enter an amount.');
    if (note.trim().length < 2) return setError('Say what this is for.');
    setError(null);
    schedule.mutate(
      { date, amount: pounds(n), note: note.trim() },
      {
        onSuccess: () => {
          setOpen(false);
          setDate('');
          setAmount('');
          setNote('');
        },
      },
    );
  };

  return (
    <div className="border-line bg-card mb-4 rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-ink text-sm font-semibold">Scheduled petty cash</p>
          <p className="text-muted text-xs">
            Goes into the tin on the day chosen. On a Monday it goes in after the weekly reset.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" />
          Schedule
        </Button>
      </div>
      {scheduled && scheduled.length > 0 ? (
        <ul className="divide-line mt-2 divide-y text-sm">
          {scheduled.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>
                <span className="text-ink tabular font-semibold">{s.date}</span>{' '}
                <span className="tabular">{formatGBP(s.amount)}</span>{' '}
                <span className="text-muted">{s.note}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(s.id)}
              >
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Schedule Petty Cash In</DialogTitle>
            <DialogDescription>Added to the tin on that day.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Date" htmlFor="sched-date">
              <Input
                id="sched-date"
                type="date"
                min={today}
                className="tabular"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Amount (£)" htmlFor="sched-amount">
              <Input
                id="sched-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="tabular"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Note" htmlFor="sched-note">
              <Input
                id="sched-note"
                placeholder="e.g. Weekly top-up"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            {error ? (
              <p role="alert" className="text-red-deep text-xs font-semibold">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={schedule.isPending}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={schedule.isPending}>
                {schedule.isPending ? 'Saving…' : 'Schedule'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---- record entry dialog --------------------------------------------------- */

const cashFormSchema = z.object({
  kind: z.enum(['float-open', 'petty-in', 'petty-out']),
  amountPounds: z.string().min(1, 'Enter an amount'),
  note: z.string().trim().min(2, 'Say what this was for'),
});
type CashFormValues = z.infer<typeof cashFormSchema>;

function CashEntryDialog({
  open,
  onOpenChange,
  floatRecorded,
  pettyBalance,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  floatRecorded: boolean;
  /** What the petty cash tin holds now (0121); null while petty cash is still part of the drawer. */
  pettyBalance: number | null;
}) {
  const { data: settings } = useSettings();
  const { data: session } = useSession();
  const createEntry = useCreateCashEntry();

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<CashFormValues>({
    resolver: zodResolver(cashFormSchema),
    defaultValues: {
      kind: floatRecorded ? 'petty-out' : 'float-open',
      amountPounds: '',
      note: '',
    },
  });
  const kind = watch('kind');

  const submit = handleSubmit((values) => {
    createEntry.mutate(
      {
        // `date` and `staffName` are ignored by the API — it takes the trading
        // day from shop_day() and the staff member from the session. They're
        // still sent because the request type carries them.
        date: isoDay(),
        kind: values.kind,
        amount: pounds(Number(values.amountPounds) || 0),
        note: values.note,
        staffName: session?.name ?? 'Staff',
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Record cash entry</DialogTitle>
          <DialogDescription>
            Float and petty cash only — sales go through the till.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Entry" htmlFor="cash-kind">
            <Select id="cash-kind" {...register('kind')}>
              <option value="float-open" disabled={floatRecorded}>
                Opening float{floatRecorded ? ' (already recorded)' : ''}
              </option>
              <option value="petty-in">Petty cash in</option>
              <option value="petty-out">Petty cash out</option>
            </Select>
          </Field>
          <Field
            label="Amount (£)"
            htmlFor="cash-amount"
            error={errors.amountPounds?.message}
            hint={
              kind === 'float-open' && settings
                ? `Float target is ${formatGBP(settings.floatTarget)}`
                : kind !== 'float-open' && pettyBalance !== null
                  ? `The petty cash tin holds ${formatGBP(pettyBalance)}`
                  : undefined
            }
          >
            <Input
              id="cash-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className="tabular"
              autoFocus
              {...register('amountPounds')}
            />
          </Field>
          <Field label="Note" htmlFor="cash-note" error={errors.note?.message}>
            <Input
              id="cash-note"
              placeholder={kind === 'petty-out' ? 'e.g. Courier drop-off' : 'e.g. Opening float'}
              {...register('note')}
            />
          </Field>
          {/*
            No "recorded by" picker: the server stamps the entry with the
            signed-in staff member from the session and ignores anything the
            body says, so offering a choice would only misrepresent who
            actually recorded the money.
          */}
          <p className="text-muted text-xs">
            Recorded as <span className="text-ink font-medium">{session?.name ?? 'you'}</span>.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={createEntry.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createEntry.isPending}>
              {createEntry.isPending ? 'Recording…' : 'Record'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
