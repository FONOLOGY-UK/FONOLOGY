'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Pencil, Plus } from 'lucide-react';
import { useAdminRepairTypes, useDeleteRepairType, useSaveRepairType } from '@/lib/data/hooks';
import type { AdminRepairType, AdminRepairTypeInput } from '@/lib/data/types';
import { formatGBP, pounds } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/admin/field';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';

/**
 * Repair problems & part-quality pricing (Round 5 #33, admin half).
 * `repair_types` already existed as a real table with real pricing columns
 * (base_price_original/oem/copy) — this is the first UI for it, built by
 * reusing the Device Models admin page (Round 4 #FEAT-01) pattern exactly:
 * same list/dialog shape, same soft-delete-only reasoning (a repair type
 * referenced by a real historical booking keeps its name on that record
 * either way — deactivating just removes it from the customer-facing form
 * for a NEW booking), same permission gate (inventory.manage — catalogue
 * upkeep, same tier as devices).
 */
export function RepairTypesView() {
  const { data: repairTypes, isPending, isError, refetch } = useAdminRepairTypes();
  const saveRepairType = useSaveRepairType();
  const deleteRepairType = useDeleteRepairType();

  const [editing, setEditing] = useState<AdminRepairType | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const toggleActive = (repairType: AdminRepairType) => {
    if (repairType.isActive) {
      deleteRepairType.mutate(repairType.id);
    } else {
      saveRepairType.mutate({
        id: repairType.id,
        name: repairType.name,
        desc: repairType.desc,
        time: repairType.time,
        base: repairType.base,
        isActive: true,
      });
    }
  };

  const sorted = repairTypes
    ? [...repairTypes].sort((a, b) => a.name.localeCompare(b.name))
    : undefined;

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Repair Pricing"
        description="The problems offered on /repair, and what each part quality costs before the device multiplier. Deactivating one removes it from the repair form immediately."
        actions={
          <Button onClick={openNew}>
            <Plus aria-hidden="true" />
            Add repair
          </Button>
        }
      />

      {isError ? (
        <div className="border-line bg-card rounded-lg border p-8 text-center">
          <p className="text-ink mb-3 text-sm font-semibold">Repair types didn’t load.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-[72px]" />
          <Skeleton className="h-[72px]" />
          <Skeleton className="h-[72px]" />
        </div>
      ) : sorted && sorted.length > 0 ? (
        <div className="grid gap-2">
          {sorted.map((repairType) => (
            <RepairTypeRow
              key={repairType.id}
              repairType={repairType}
              busy={saveRepairType.isPending || deleteRepairType.isPending}
              onToggleActive={() => toggleActive(repairType)}
              onEdit={() => {
                setEditing(repairType);
                setDialogOpen(true);
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No repair types yet"
          description="Add the problems the repair form should offer."
          action={<Button onClick={openNew}>Add repair</Button>}
        />
      )}

      <RepairTypeDialog
        key={editing?.id ?? 'new'}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        repairType={editing}
      />
    </div>
  );
}

/* ---- one repair type ----------------------------------------------------- */

function RepairTypeRow({
  repairType,
  busy,
  onToggleActive,
  onEdit,
}: {
  repairType: AdminRepairType;
  busy: boolean;
  onToggleActive: () => void;
  onEdit: () => void;
}) {
  return (
    <article className="border-line bg-card flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-ink text-sm font-bold">{repairType.name}</h2>
          {repairType.isActive ? (
            <StatusChip tone="success">Active</StatusChip>
          ) : (
            <StatusChip tone="neutral">Inactive</StatusChip>
          )}
          {!repairType.base ? (
            <span className="bg-paper-2/60 text-muted rounded-md px-2 py-0.5 text-[11px] font-semibold">
              Diagnosis only
            </span>
          ) : null}
        </div>
        {repairType.desc ? <p className="text-muted mt-0.5 text-xs">{repairType.desc}</p> : null}
        <p className="text-muted mt-0.5 text-xs">
          {repairType.time ? <>{repairType.time} · </> : null}
          {repairType.base ? (
            <span className="tabular">
              Original {formatGBP(repairType.base.original)} · OEM {formatGBP(repairType.base.oem)}{' '}
              · Copy {formatGBP(repairType.base.copy)}
            </span>
          ) : (
            'Quoted after inspection — no base price'
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          disabled={busy}
          onClick={onToggleActive}
        >
          {repairType.isActive ? (
            <>
              <EyeOff className="size-3.5" aria-hidden="true" />
              Deactivate
            </>
          ) : (
            <>
              <Eye className="size-3.5" aria-hidden="true" />
              Activate
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          aria-label={`Edit ${repairType.name}`}
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
      </div>
    </article>
  );
}

/* ---- create / edit dialog -------------------------------------------------- */

const repairTypeFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a repair name'),
    desc: z.string().trim(),
    time: z.string().trim(),
    isActive: z.boolean(),
    diagnosisOnly: z.boolean(),
    original: z.string(),
    oem: z.string(),
    copy: z.string(),
  })
  // Mirrors the DB's repair_types_all_or_no_pricing constraint: a priced
  // repair needs all three tiers filled in, not just some of them.
  .superRefine((v, ctx) => {
    if (v.diagnosisOnly) return;
    for (const field of ['original', 'oem', 'copy'] as const) {
      if (!v[field].trim() || Number.isNaN(Number(v[field]))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Enter a price, or tick "Diagnosis only"',
          path: [field],
        });
      }
    }
  });
type RepairTypeFormValues = z.infer<typeof repairTypeFormSchema>;

function RepairTypeDialog({
  open,
  onOpenChange,
  repairType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repairType: AdminRepairType | null;
}) {
  const saveRepairType = useSaveRepairType();
  const pending = saveRepairType.isPending;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RepairTypeFormValues>({
    resolver: zodResolver(repairTypeFormSchema),
    defaultValues: repairType
      ? {
          name: repairType.name,
          desc: repairType.desc,
          time: repairType.time,
          isActive: repairType.isActive,
          diagnosisOnly: !repairType.base,
          original: repairType.base ? `${repairType.base.original / 100}` : '',
          oem: repairType.base ? `${repairType.base.oem / 100}` : '',
          copy: repairType.base ? `${repairType.base.copy / 100}` : '',
        }
      : {
          name: '',
          desc: '',
          time: '',
          isActive: true,
          diagnosisOnly: false,
          original: '',
          oem: '',
          copy: '',
        },
  });
  const diagnosisOnly = watch('diagnosisOnly');

  const submit = handleSubmit((values) => {
    const input: AdminRepairTypeInput & { id?: string } = {
      ...(repairType ? { id: repairType.id } : {}),
      name: values.name,
      desc: values.desc,
      time: values.time,
      isActive: values.isActive,
      base: values.diagnosisOnly
        ? null
        : {
            original: pounds(Number(values.original) || 0),
            oem: pounds(Number(values.oem) || 0),
            copy: pounds(Number(values.copy) || 0),
          },
    };
    saveRepairType.mutate(input, { onSuccess: () => onOpenChange(false) });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{repairType ? 'Edit repair' : 'Add repair'}</DialogTitle>
          <DialogDescription>
            Shows up on /repair the moment this saves — prices are per device’s base tier, before
            the device’s own multiplier.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <Field label="Name" htmlFor="rt-name" error={errors.name?.message}>
            <Input
              id="rt-name"
              autoFocus
              placeholder="e.g. Screen replacement"
              {...register('name')}
            />
          </Field>
          <Field label="Description" htmlFor="rt-desc" hint="Shown under the problem on step 2.">
            <Textarea
              id="rt-desc"
              rows={2}
              placeholder="e.g. Cracked glass, dead pixels, ghost touch"
              {...register('desc')}
            />
          </Field>
          <Field
            label="Estimate"
            htmlFor="rt-time"
            hint='Free text — e.g. "40–60 min" or "Free diagnosis".'
          >
            <Input id="rt-time" placeholder="e.g. 40–60 min" {...register('time')} />
          </Field>

          <label className="flex items-center gap-2.5 text-sm font-semibold">
            <input type="checkbox" className="accent-[var(--red)]" {...register('diagnosisOnly')} />
            Diagnosis only — no price until we’ve inspected it
          </label>

          {!diagnosisOnly ? (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Original (£)" htmlFor="rt-original" error={errors.original?.message}>
                <Input
                  id="rt-original"
                  type="number"
                  min="0"
                  step="0.01"
                  className="tabular"
                  {...register('original')}
                />
              </Field>
              <Field label="OEM (£)" htmlFor="rt-oem" error={errors.oem?.message}>
                <Input
                  id="rt-oem"
                  type="number"
                  min="0"
                  step="0.01"
                  className="tabular"
                  {...register('oem')}
                />
              </Field>
              <Field label="Copy (£)" htmlFor="rt-copy" error={errors.copy?.message}>
                <Input
                  id="rt-copy"
                  type="number"
                  min="0"
                  step="0.01"
                  className="tabular"
                  {...register('copy')}
                />
              </Field>
            </div>
          ) : null}

          <label className="flex items-center gap-2.5 text-sm font-semibold">
            <input type="checkbox" className="accent-[var(--red)]" {...register('isActive')} />
            Active — shows on /repair
          </label>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : repairType ? 'Save changes' : 'Add repair'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
