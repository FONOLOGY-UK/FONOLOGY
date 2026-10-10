'use client';

import { useState } from 'react';
import { Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  useAdminRepairSubTypes,
  useAdminRepairTypes,
  useDeleteRepairSubType,
  useDeleteRepairType,
  useSaveRepairSubType,
  useSaveRepairType,
} from '@/lib/data/hooks';
import type { AdminRepairSubType, AdminRepairType } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { cn } from '@/lib/utils';

/**
 * Repair Types (, 0109) — DEFINITIONS ONLY. There is no price anywhere on this
 * tab: prices are typed per device on Device Models, and a repair with no price on a device is
 * not offered for it.
 *
 *   * A repair type: name, description, time estimate, the sub-types it comes in, and a
 *     "Diagnosis only" flag (no sub-types; one flat price per device).
 *   * Sub-types: the shop-wide list of grades (Original, OEM, Copy by default) — add, edit,
 *     delete. Deleting is a soft delete: past jobs keep it; it stops being offered anywhere.
 *
 * Deactivating a repair type removes it from the website and job creation at once (soft delete,
 * so a repair on a past booking keeps its name).
 */
export function RepairTypesView() {
  const { data: repairTypes, isPending, isError, refetch } = useAdminRepairTypes();
  const { data: subTypes } = useAdminRepairSubTypes();
  const saveRepairType = useSaveRepairType();
  const deleteRepairType = useDeleteRepairType();

  const [editing, setEditing] = useState<AdminRepairType | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Every opening is a fresh form: the dialog reads its starting values once, when it mounts.
  const [opening, setOpening] = useState(0);

  const openNew = () => {
    setEditing(null);
    setOpening((n) => n + 1);
    setDialogOpen(true);
  };

  const toggleActive = (r: AdminRepairType) => {
    if (r.isActive) deleteRepairType.mutate(r.id);
    else
      saveRepairType.mutate({
        id: r.id,
        name: r.name,
        desc: r.desc,
        time: r.time,
        diagnosisOnly: r.diagnosisOnly,
        subTypeIds: r.subTypeIds,
        isActive: true,
      });
  };

  const sorted = repairTypes ? [...repairTypes].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const subTypeName = (id: string) => subTypes?.find((s) => s.id === id)?.name;

  return (
    <div className="grid gap-8">
      <div>
        <PageHeader
          eyebrow="Catalogue"
          title="Repair Types"
          description="What the shop repairs: the problem, how long it takes, and which grades it comes in. No prices here — each device’s prices are set on Device Models, and a repair with no price on a device isn’t offered for it."
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
          </div>
        ) : sorted.length > 0 ? (
          <div className="grid gap-2">
            {sorted.map((r) => (
              <article
                key={r.id}
                className="border-line bg-card flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-ink text-sm font-bold">{r.name}</h2>
                    {r.isActive ? (
                      <StatusChip tone="success">Active</StatusChip>
                    ) : (
                      <StatusChip tone="neutral">Inactive</StatusChip>
                    )}
                    {r.diagnosisOnly ? (
                      <span className="bg-paper-2/60 text-muted rounded-md px-2 py-0.5 text-[11px] font-semibold">
                        Diagnosis only
                      </span>
                    ) : null}
                  </div>
                  {r.desc ? <p className="text-muted mt-0.5 text-xs">{r.desc}</p> : null}
                  <p className="text-muted mt-0.5 text-xs">
                    {r.time ? <>{r.time} · </> : null}
                    {r.diagnosisOnly
                      ? 'One flat price per device'
                      : r.subTypeIds.length
                        ? r.subTypeIds.map(subTypeName).filter(Boolean).join(' · ')
                        : 'No sub-types chosen — not offered anywhere until one is'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2 text-xs"
                    disabled={saveRepairType.isPending || deleteRepairType.isPending}
                    onClick={() => toggleActive(r)}
                  >
                    {r.isActive ? (
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
                    aria-label={`Edit ${r.name}`}
                    onClick={() => {
                      setEditing(r);
                      setOpening((n) => n + 1);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No repair types yet"
            description="Add the problems the shop repairs."
            action={<Button onClick={openNew}>Add repair</Button>}
          />
        )}
      </div>

      <SubTypesSection subTypes={subTypes} />

      <RepairTypeDialog
        // …and it waits for the sub-types, or a new repair would start with none ticked.
        key={`${editing?.id ?? 'new'}-${opening}-${subTypes ? 'ready' : 'loading'}`}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        repairType={editing}
        subTypes={subTypes ?? []}
      />
    </div>
  );
}

/* ---- the add / edit dialog ------------------------------------------------- */

function RepairTypeDialog({
  open,
  onOpenChange,
  repairType,
  subTypes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repairType: AdminRepairType | null;
  subTypes: AdminRepairSubType[];
}) {
  const save = useSaveRepairType();
  const [name, setName] = useState(repairType?.name ?? '');
  const [desc, setDesc] = useState(repairType?.desc ?? '');
  const [time, setTime] = useState(repairType?.time ?? '');
  const [diagnosisOnly, setDiagnosisOnly] = useState(repairType?.diagnosisOnly ?? false);
  // A new standard repair comes in every current sub-type unless the admin unticks some.
  const [chosen, setChosen] = useState<string[]>(
    repairType ? repairType.subTypeIds : subTypes.map((s) => s.id),
  );
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) return setError('Enter a repair name.');
    if (!diagnosisOnly && chosen.length === 0) {
      return setError('Tick at least one sub-type, or mark it Diagnosis only.');
    }
    setError(null);
    save.mutate(
      {
        ...(repairType ? { id: repairType.id } : {}),
        name: name.trim(),
        desc: desc.trim(),
        time: time.trim(),
        isActive: repairType?.isActive ?? true,
        diagnosisOnly,
        // Diagnosis only: sub-types are cleared, not just hidden (spec C-3.2).
        subTypeIds: diagnosisOnly ? [] : chosen,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{repairType ? `Edit ${repairType.name}` : 'Add a repair type'}</DialogTitle>
          <DialogDescription>
            Definitions only — set each device’s prices on Device Models.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Name" htmlFor="rt-name">
            <Input id="rt-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="rt-desc">
            <Textarea
              id="rt-desc"
              rows={2}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </Field>
          <Field label="Time estimate" htmlFor="rt-time" hint="e.g. 40–60 min">
            <Input id="rt-time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2.5 text-sm font-semibold">
            <input
              type="checkbox"
              className="accent-[var(--red)]"
              checked={diagnosisOnly}
              onChange={(e) => setDiagnosisOnly(e.target.checked)}
            />
            Diagnosis only
          </label>
          {diagnosisOnly ? (
            <p className="text-muted -mt-2 text-xs">
              No sub-types — each device gets one flat price for it on Device Models.
            </p>
          ) : (
            <Field label="Sub-types it comes in">
              <div className="flex flex-wrap gap-2">
                {subTypes.length === 0 ? (
                  <span className="text-muted text-xs">Add a sub-type below first.</span>
                ) : (
                  subTypes.map((s) => {
                    const on = chosen.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setChosen((c) => (on ? c.filter((x) => x !== s.id) : [...c, s.id]))
                        }
                        className={cn(
                          'border-line rounded-full border px-3 py-1.5 text-xs font-semibold',
                          on && 'border-ink bg-ink text-paper',
                        )}
                      >
                        {s.name}
                      </button>
                    );
                  })
                )}
              </div>
            </Field>
          )}
          {error ? (
            <p role="alert" className="text-red-deep text-xs font-semibold">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {repairType ? 'Save repair' : 'Add repair'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---- sub-types --------------------------------------------------------------- */

function SubTypesSection({ subTypes }: { subTypes: AdminRepairSubType[] | undefined }) {
  const save = useSaveRepairSubType();
  const remove = useDeleteRepairSubType();
  const [editing, setEditing] = useState<AdminRepairSubType | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminRepairSubType | null>(null);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-ink text-lg font-extrabold uppercase">Sub-types</h2>
          <p className="text-muted text-sm">
            The grades a repair comes in. Original, OEM and Copy to start with — add your own.
          </p>
        </div>
        <Button variant="outline" onClick={() => setEditing('new')}>
          <Plus aria-hidden="true" />
          Add sub-type
        </Button>
      </div>
      <div className="grid gap-2">
        {(subTypes ?? []).map((s) => (
          <article
            key={s.id}
            className="border-line bg-card flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <h3 className="text-ink text-sm font-bold">{s.name}</h3>
              <p className="text-muted text-xs">
                {[s.strap, s.warranty].filter(Boolean).join(' · ') || '—'}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                aria-label={`Edit ${s.name}`}
                onClick={() => setEditing(s)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                aria-label={`Delete ${s.name}`}
                onClick={() => setDeleting(s)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </article>
        ))}
      </div>

      {editing ? (
        <SubTypeDialog
          subType={editing === 'new' ? null : editing}
          busy={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            save.mutate(
              { ...(editing !== 'new' ? { id: editing.id } : {}), ...input },
              { onSuccess: () => setEditing(null) },
            )
          }
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => (!o ? setDeleting(null) : undefined)}
        destructive
        title={`Delete ${deleting?.name ?? 'this sub-type'}?`}
        description="It stops being offered on every repair and every device straight away. Past jobs and requests that used it keep showing it."
        confirmLabel="Delete sub-type"
        loading={remove.isPending}
        onConfirm={() =>
          deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
        }
      />
    </section>
  );
}

function SubTypeDialog({
  subType,
  busy,
  onClose,
  onSave,
}: {
  subType: AdminRepairSubType | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: { name: string; strap: string; warranty: string }) => void;
}) {
  const [name, setName] = useState(subType?.name ?? '');
  const [strap, setStrap] = useState(subType?.strap ?? '');
  const [warranty, setWarranty] = useState(subType?.warranty ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{subType ? `Edit ${subType.name}` : 'Add a sub-type'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Name" htmlFor="st-name">
            <Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Short line" htmlFor="st-strap" hint="Shown to customers under the name">
            <Input id="st-strap" value={strap} onChange={(e) => setStrap(e.target.value)} />
          </Field>
          <Field label="Warranty" htmlFor="st-warranty" hint="e.g. 12-month warranty">
            <Input
              id="st-warranty"
              value={warranty}
              onChange={(e) => setWarranty(e.target.value)}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-red-deep text-xs font-semibold">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              if (!name.trim()) return setError('Name the sub-type.');
              onSave({ name: name.trim(), strap: strap.trim(), warranty: warranty.trim() });
            }}
          >
            {subType ? 'Save sub-type' : 'Add sub-type'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
