'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Pencil, Plus } from 'lucide-react';
import {
  useAdminDevices,
  useAdminRepairSubTypes,
  useAdminRepairTypes,
  useDeleteDevice,
  useDevicePrices,
  useSaveDevice,
} from '@/lib/data/hooks';
import type { AdminDevice, DeviceBrand, DevicePrice } from '@/lib/data/types';
import { pounds } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/admin/field';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';

/**
 * Device Models — the phone models offered in Repair and Sell-In, and since 0109 (tester change
 * C-3) each one's REPAIR PRICES, typed in by hand. The old price multiplier is gone.
 *
 *   * Standard repairs: one price per sub-type the repair comes in (Original, OEM, Copy …).
 *   * Diagnosis-only repairs: one flat price.
 *   * BLANK = NOT OFFERED for this device — it appears nowhere for it. 0 = a deliberate free repair.
 *
 * A new device can copy another's whole price list ("Duplicate pricing from existing device"): the
 * figures are copied into the form, editable before saving, and from then on belong to this device
 * only — editing either device later never touches the other.
 *
 * "Deactivate" rather than delete: a model on a past booking or sell request keeps its name there.
 */
export function DevicesView() {
  const { data: devices, isPending, isError, refetch } = useAdminDevices();
  const saveDevice = useSaveDevice();
  const deleteDevice = useDeleteDevice();
  const [editing, setEditing] = useState<AdminDevice | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const toggleActive = (device: AdminDevice) => {
    if (device.isActive) deleteDevice.mutate(device.id);
    // No `prices`: switching a device back on leaves its price list exactly as it was.
    else
      saveDevice.mutate({ id: device.id, name: device.name, brand: device.brand, isActive: true });
  };

  const sorted = devices ? [...devices].sort((a, b) => a.name.localeCompare(b.name)) : undefined;

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Device Models"
        description="The phone models offered in Repair and Sell-In, and what each repair costs on each one. A repair left blank on a device isn’t offered for it."
        actions={
          <Button onClick={openNew}>
            <Plus aria-hidden="true" />
            Add device
          </Button>
        }
      />

      {isError ? (
        <div className="border-line bg-card rounded-lg border p-8 text-center">
          <p className="text-ink mb-3 text-sm font-semibold">Devices didn’t load.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-[64px]" />
          <Skeleton className="h-[64px]" />
        </div>
      ) : sorted && sorted.length > 0 ? (
        <div className="grid gap-2">
          {sorted.map((device) => (
            <article
              key={device.id}
              className="border-line bg-card flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="text-ink text-sm font-bold">{device.name}</h2>
                <span className="text-muted text-xs">{BRAND_LABEL[device.brand]}</span>
                {device.isActive ? (
                  <StatusChip tone="success">Active</StatusChip>
                ) : (
                  <StatusChip tone="neutral">Inactive</StatusChip>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2 text-xs"
                  disabled={saveDevice.isPending || deleteDevice.isPending}
                  onClick={() => toggleActive(device)}
                >
                  {device.isActive ? (
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
                  className="h-8 gap-1.5 px-2 text-xs"
                  aria-label={`Edit ${device.name} and its prices`}
                  onClick={() => {
                    setEditing(device);
                    setDialogOpen(true);
                  }}
                >
                  <Pencil className="size-3.5" />
                  Edit &amp; prices
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No device models yet"
          description="Add the phone models Repair and Sell-In should offer."
          action={<Button onClick={openNew}>Add device</Button>}
        />
      )}

      {dialogOpen ? (
        <DeviceDialog
          key={editing?.id ?? 'new'}
          device={editing}
          devices={devices ?? []}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}

const BRAND_LABEL: Record<DeviceBrand, string> = {
  apple: 'Apple',
  samsung: 'Samsung',
  pixel: 'Google',
  other: 'Other',
};

/** A price cell's key: repair + sub-type ('' for a Diagnosis-only repair's flat price). */
const cellKey = (repairTypeId: string, subTypeId: string | null) =>
  `${repairTypeId}:${subTypeId ?? ''}`;

/** Prices as the form holds them: pounds as typed; '' = blank = not offered. */
type Grid = Record<string, string>;

function toGrid(prices: DevicePrice[]): Grid {
  const grid: Grid = {};
  for (const p of prices) grid[cellKey(p.repairTypeId, p.subTypeId)] = (p.price / 100).toFixed(2);
  return grid;
}

function DeviceDialog({
  device,
  devices,
  onClose,
}: {
  device: AdminDevice | null;
  devices: AdminDevice[];
  onClose: () => void;
}) {
  const save = useSaveDevice();
  const { data: repairTypes } = useAdminRepairTypes();
  const { data: subTypes } = useAdminRepairSubTypes();
  const own = useDevicePrices(device?.id);
  const [copyFrom, setCopyFrom] = useState('');
  const source = useDevicePrices(copyFrom || null);

  const [name, setName] = useState(device?.name ?? '');
  const [brand, setBrand] = useState<DeviceBrand>(device?.brand ?? 'apple');
  const [grid, setGrid] = useState<Grid>({});
  const [loaded, setLoaded] = useState(!device);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Editing: start from the device's own saved prices.
  useEffect(() => {
    if (device && own.data && !loaded) {
      setGrid(toGrid(own.data));
      setLoaded(true);
    }
  }, [device, own.data, loaded]);

  // Duplicating: the other device's figures are COPIED into this form (values, not a link).
  useEffect(() => {
    if (copyFrom && source.data) setGrid(toGrid(source.data));
  }, [copyFrom, source.data]);

  const active = (repairTypes ?? []).filter((r) => r.isActive || device);
  const rows = active
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ({
      repair: r,
      cells: r.diagnosisOnly
        ? [{ key: cellKey(r.id, null), subTypeId: null as string | null, label: 'Flat price' }]
        : (subTypes ?? [])
            .filter((s) => r.subTypeIds.includes(s.id))
            .map((s) => ({
              key: cellKey(r.id, s.id),
              subTypeId: s.id as string | null,
              label: s.name,
            })),
    }));

  const submit = () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Enter a device name';
    const prices: DevicePrice[] = [];
    for (const row of rows) {
      for (const c of row.cells) {
        const raw = (grid[c.key] ?? '').trim();
        if (!raw) continue; // blank = not offered (never stored as 0)
        if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
          next[c.key] = 'Pounds, e.g. 89.99';
          continue;
        }
        prices.push({
          repairTypeId: row.repair.id,
          subTypeId: c.subTypeId,
          price: pounds(Number(raw)),
        });
      }
    }
    // A saved price this form doesn't show (its sub-type was switched off for that repair) is
    // kept as it is — not offered now, but back if the sub-type is switched on again.
    const shown = new Set(rows.flatMap((r) => r.cells.map((c) => c.key)));
    if (device && !copyFrom) {
      for (const p of own.data ?? []) {
        if (!shown.has(cellKey(p.repairTypeId, p.subTypeId))) prices.push(p);
      }
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate(
      {
        ...(device ? { id: device.id } : {}),
        name: name.trim(),
        brand,
        isActive: device?.isActive ?? true,
        prices,
      },
      { onSuccess: onClose },
    );
  };

  const others = devices
    .filter((d) => d.id !== device?.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Dialog open onOpenChange={(o) => (!o && !save.isPending ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{device ? `Edit ${device.name}` : 'Add a device'}</DialogTitle>
          <DialogDescription>
            Type the exact price of each repair on this device. Leave a price blank if it isn’t
            offered; 0 means it’s free.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Model name" htmlFor="dv-name" error={errors.name}>
              <Input id="dv-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Brand" htmlFor="dv-brand">
              <Select
                id="dv-brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value as DeviceBrand)}
              >
                {(Object.keys(BRAND_LABEL) as DeviceBrand[]).map((b) => (
                  <option key={b} value={b}>
                    {BRAND_LABEL[b]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {!device ? (
            <Field
              label="Duplicate pricing from existing device"
              htmlFor="dv-copy"
              hint="Optional. Copies its prices into the form — you can change any before saving."
            >
              <Select id="dv-copy" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                <option value="">Don’t copy — start blank</option>
                {others.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <div className="grid gap-3">
            <h3 className="text-ink text-[11px] font-semibold uppercase tracking-[0.08em]">
              Repair prices (£)
            </h3>
            {!loaded || (copyFrom && source.isPending) ? (
              <Skeleton className="h-32" />
            ) : rows.length === 0 ? (
              <p className="text-muted text-sm">No repair types yet — add them on Repair Types.</p>
            ) : (
              rows.map(({ repair, cells }) => (
                <div
                  key={repair.id}
                  role="group"
                  aria-label={`${repair.name} prices`}
                  className="border-line rounded-ui border p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-ink text-sm font-bold">{repair.name}</span>
                    {repair.diagnosisOnly ? (
                      <span className="text-muted text-xs">Diagnosis only</span>
                    ) : null}
                    {!repair.isActive ? (
                      <span className="text-muted text-xs">(inactive)</span>
                    ) : null}
                  </div>
                  {cells.length === 0 ? (
                    <p className="text-muted text-xs">No sub-types chosen for this repair yet.</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-3">
                      {cells.map((c) => (
                        <Field
                          key={c.key}
                          label={c.label}
                          htmlFor={`dv-${c.key}`}
                          error={errors[c.key]}
                        >
                          <Input
                            id={`dv-${c.key}`}
                            className="tabular"
                            inputMode="decimal"
                            placeholder="Not offered"
                            value={grid[c.key] ?? ''}
                            onChange={(e) => setGrid((g) => ({ ...g, [c.key]: e.target.value }))}
                          />
                        </Field>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending || !loaded}>
            {device ? 'Save device' : 'Add device'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
