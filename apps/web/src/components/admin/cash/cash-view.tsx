'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { Banknote, Lock, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useCashEntries,
  useCreateCashEntry,
  useDayCloses,
  useSession,
  useSettings,
  useShopDay,
} from '@/lib/data/hooks';
import type { CashEntry, CashEntryKind, DayClose } from '@/lib/data/types';
import { cashEntryKindLabel, formatGBP, pounds } from '@/lib/data/types';
import { formatDateTime, isoDay } from '@/lib/dates';
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
export function CashView() {
  // The trading day is the server's (Europe/London), never the browser clock.
  const { data: today } = useShopDay();
  const { data: entries, isPending, isError, refetch } = useCashEntries();

  const { data: closes } = useDayCloses();
  const [recording, setRecording] = useState(false);

  const todayEntries = useMemo(
    () => (today ? (entries?.filter((e) => e.date === today) ?? []) : []),
    [entries, today],
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
        description="Float and petty cash — kept apart from sales revenue."
        actions={
          <Button onClick={() => setRecording(true)}>
            <Plus aria-hidden="true" />
            Record entry
          </Button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Opening float"
          value={float ? formatGBP(float.amount) : 'Not set'}
          sub={float ? `by ${recordedBy(float)}` : 'record it below'}
          isLoading={isPending}
        />
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

      <DataTable
        data={entries}
        columns={columns}
        isLoading={isPending}
        isError={isError}
        errorMessage="The cash history didn’t load."
        onRetry={() => refetch()}
        searchPlaceholder="Search notes or names…"
        pageSize={10}
        empty={{
          title: 'No cash entries yet',
          description: 'Opening floats and petty cash will build the history here.',
        }}
      />

      <CashEntryDialog open={recording} onOpenChange={setRecording} floatRecorded={!!float} />
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
          <dd className="text-ink tabular font-medium">
            {close.variance > 0 ? '+' : ''}
            {formatGBP(close.variance, { alwaysShowPennies: true })}
          </dd>
        </div>
      </dl>
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  floatRecorded: boolean;
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
        // still sent because the mock adapter builds its row from them.
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
