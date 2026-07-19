'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Banknote, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useCashEntries,
  useCreateCashEntry,
  useSettings,
  useStaff,
  useTransactions,
} from '@/lib/data/hooks';
import type { CashEntry, CashEntryKind } from '@/lib/data/types';
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
 * Float & petty cash (item 7). Drawer money is tracked separately from sales
 * revenue: the opening float, petty in/out, and an expected-drawer figure
 * that folds in today's cash-tender takings so a till count has a target.
 */
export function CashView() {
  const today = isoDay();
  const { data: entries, isPending, isError, refetch } = useCashEntries();
  const todayCash = useTransactions({ from: today, to: today });
  const [recording, setRecording] = useState(false);

  const todayEntries = useMemo(
    () => entries?.filter((e) => e.date === today) ?? [],
    [entries, today],
  );
  const float = todayEntries.find((e) => e.kind === 'float-open');
  const pettyIn = todayEntries
    .filter((e) => e.kind === 'petty-in')
    .reduce((s, e) => s + e.amount, 0);
  const pettyOut = todayEntries
    .filter((e) => e.kind === 'petty-out')
    .reduce((s, e) => s + e.amount, 0);
  const cashTakings =
    todayCash.data?.filter((t) => t.tender === 'cash').reduce((s, t) => s + t.amount, 0) ?? 0;
  const expected = (float?.amount ?? 0) + pettyIn - pettyOut + cashTakings;

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
        accessorKey: 'staffName',
        header: 'By',
        cell: ({ getValue }) => <span className="text-muted">{getValue<string>()}</span>,
      },
    ];
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

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Opening float"
          value={float ? formatGBP(float.amount) : 'Not set'}
          sub={float ? `by ${float.staffName}` : 'record it below'}
          isLoading={isPending}
        />
        <StatTile
          label="Petty cash today"
          value={`${pettyIn - pettyOut < 0 ? '−' : '+'}${formatGBP(Math.abs(pettyIn - pettyOut))}`}
          sub={`in ${formatGBP(pettyIn)} · out ${formatGBP(pettyOut)}`}
          isLoading={isPending}
        />
        <StatTile
          label="Cash takings today"
          value={formatGBP(cashTakings)}
          sub="cash-tender sales"
          isLoading={todayCash.isPending}
        />
        <StatTile
          label="Expected in drawer"
          value={formatGBP(Math.max(0, expected))}
          sub="count against this"
          isLoading={isPending || todayCash.isPending}
        />
      </div>

      {!isPending && !float ? (
        <div className="border-line bg-blush text-ink-2 mb-4 flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm">
          <Banknote className="text-red-deep size-4 shrink-0" aria-hidden="true" />
          <p>
            <strong>No opening float recorded today.</strong> Count the till and record it so the
            drawer figure means something.
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

/* ---- record entry dialog --------------------------------------------------- */

const cashFormSchema = z.object({
  kind: z.enum(['float-open', 'petty-in', 'petty-out']),
  amountPounds: z.string().min(1, 'Enter an amount'),
  note: z.string().trim().min(2, 'Say what this was for'),
  staffName: z.string().min(1, 'Who recorded this?'),
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
  const { data: staff } = useStaff();
  const { data: settings } = useSettings();
  const createEntry = useCreateCashEntry();
  const activeStaff = staff?.filter((s) => s.active) ?? [];

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
      staffName: '',
    },
  });
  const kind = watch('kind');

  const submit = handleSubmit((values) => {
    createEntry.mutate(
      {
        date: isoDay(),
        kind: values.kind,
        amount: pounds(Number(values.amountPounds) || 0),
        note: values.note,
        staffName: values.staffName || activeStaff[0]?.name || 'Staff',
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
          <Field label="Recorded by" htmlFor="cash-staff" error={errors.staffName?.message}>
            <Select id="cash-staff" {...register('staffName')}>
              <option value="">Choose…</option>
              {activeStaff.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
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
