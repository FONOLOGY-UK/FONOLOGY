'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Pencil, Plus } from 'lucide-react';
import { useAdminDevices, useDeleteDevice, useSaveDevice } from '@/lib/data/hooks';
import type { AdminDevice, AdminDeviceInput, DeviceBrand } from '@/lib/data/types';
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
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/admin/field';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';

/**
 * Device models (Round 4 #FEAT-01) — the phone models that populate the
 * Repair and Sell-In dropdowns. These used to only be editable by hand in
 * the database; this is the first real UI for them.
 *
 * "Deactivate" rather than delete for the everyday action, same reasoning
 * as products and reviews: a model referenced by a real historical
 * booking or sell request keeps its name on that record either way, and
 * deactivating (not deleting) is what removes it from the two dropdowns
 * without losing that history. There's no separate hard delete here at
 * all — the API route backing "Deactivate" only ever sets is_active: false.
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
    if (device.isActive) {
      deleteDevice.mutate(device.id);
    } else {
      saveDevice.mutate({
        id: device.id,
        name: device.name,
        brand: device.brand,
        priceMultiplier: device.priceMultiplier,
        isActive: true,
      });
    }
  };

  const sorted = devices ? [...devices].sort((a, b) => a.name.localeCompare(b.name)) : undefined;

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Device Models"
        description="The phone models offered in Repair and Sell-In. Deactivating one removes it from both immediately."
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
          <Skeleton className="h-[64px]" />
        </div>
      ) : sorted && sorted.length > 0 ? (
        <div className="grid gap-2">
          {sorted.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              busy={saveDevice.isPending || deleteDevice.isPending}
              onToggleActive={() => toggleActive(device)}
              onEdit={() => {
                setEditing(device);
                setDialogOpen(true);
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No device models yet"
          description="Add the phone models Repair and Sell-In should offer."
          action={<Button onClick={openNew}>Add device</Button>}
        />
      )}

      <DeviceDialog
        key={editing?.id ?? 'new'}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        device={editing}
      />
    </div>
  );
}

/* ---- one device -------------------------------------------------------------- */

const BRAND_LABEL: Record<DeviceBrand, string> = {
  apple: 'Apple',
  samsung: 'Samsung',
  pixel: 'Google',
  other: 'Other',
};

function DeviceRow({
  device,
  busy,
  onToggleActive,
  onEdit,
}: {
  device: AdminDevice;
  busy: boolean;
  onToggleActive: () => void;
  onEdit: () => void;
}) {
  return (
    <article className="border-line bg-card flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-ink text-sm font-bold">{device.name}</h2>
          <span className="bg-paper-2/60 text-muted rounded-md px-2 py-0.5 text-[11px] font-semibold">
            {BRAND_LABEL[device.brand]}
          </span>
          {device.isActive ? (
            <StatusChip tone="success">Active</StatusChip>
          ) : (
            <StatusChip tone="neutral">Inactive</StatusChip>
          )}
        </div>
        <p className="text-muted mt-0.5 text-xs">
          Repair price multiplier: <span className="tabular">×{device.priceMultiplier}</span>
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
          className="h-8 px-2"
          aria-label={`Edit ${device.name}`}
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
      </div>
    </article>
  );
}

/* ---- create / edit dialog ---------------------------------------------------- */

const deviceFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a device name'),
  brand: z.enum(['apple', 'samsung', 'pixel', 'other']),
  priceMultiplier: z.string().min(1, 'Enter a multiplier'),
  isActive: z.boolean(),
});
type DeviceFormValues = z.infer<typeof deviceFormSchema>;

function DeviceDialog({
  open,
  onOpenChange,
  device,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device: AdminDevice | null;
}) {
  const saveDevice = useSaveDevice();
  const pending = saveDevice.isPending;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DeviceFormValues>({
    resolver: zodResolver(deviceFormSchema),
    defaultValues: device
      ? {
          name: device.name,
          brand: device.brand,
          priceMultiplier: `${device.priceMultiplier}`,
          isActive: device.isActive,
        }
      : { name: '', brand: 'apple', priceMultiplier: '1', isActive: true },
  });

  const submit = handleSubmit((values) => {
    const input: AdminDeviceInput & { id?: string } = {
      ...(device ? { id: device.id } : {}),
      name: values.name,
      brand: values.brand as DeviceBrand,
      priceMultiplier: Number(values.priceMultiplier) || 1,
      isActive: values.isActive,
    };
    saveDevice.mutate(input, { onSuccess: () => onOpenChange(false) });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{device ? 'Edit device' : 'Add device'}</DialogTitle>
          <DialogDescription>
            Shows up in Repair and Sell-In the moment this saves.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <Field label="Name" htmlFor="dev-name" error={errors.name?.message}>
            <Input id="dev-name" autoFocus placeholder="e.g. iPhone 16 Pro" {...register('name')} />
          </Field>
          <Field label="Brand" htmlFor="dev-brand">
            <Select id="dev-brand" {...register('brand')}>
              <option value="apple">Apple</option>
              <option value="samsung">Samsung</option>
              <option value="pixel">Google</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field
            label="Repair price multiplier"
            htmlFor="dev-multiplier"
            hint="Applied to a repair's base tier price — 1 is the baseline."
            error={errors.priceMultiplier?.message}
          >
            <Input
              id="dev-multiplier"
              type="number"
              min="0.01"
              step="0.01"
              className="tabular"
              {...register('priceMultiplier')}
            />
          </Field>
          <label className="flex items-center gap-2.5 text-sm font-semibold">
            <input type="checkbox" className="accent-[var(--red)]" {...register('isActive')} />
            Active — shows in Repair and Sell-In
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
              {pending ? 'Saving…' : device ? 'Save changes' : 'Add device'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
