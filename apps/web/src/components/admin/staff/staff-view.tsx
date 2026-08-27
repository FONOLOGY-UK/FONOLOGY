'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus, ShieldAlert } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateStaff, useStaff, useUpdateStaff } from '@/lib/data/hooks';
import type { Staff, StaffRole } from '@/lib/data/types';
import { staffRoleLabel } from '@/lib/data/types';
import { formatDay } from '@/lib/dates';
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
import { StatusChip } from '@/components/admin/status-chip';

/**
 * Staff (item 7): the roster. Deactivate rather than delete, so job and cash
 * history keeps its names. Logins/permissions are the auth phase (item 9).
 */
export function StaffView() {
  const { data: staff, isPending, isError, refetch } = useStaff();
  const updateStaff = useUpdateStaff();

  const [editing, setEditing] = useState<Staff | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const toggleActive = (member: Staff) => {
    updateStaff.mutate({
      id: member.id,
      input: {
        name: member.name,
        role: member.role,
        // Rows predating the phone requirement have none; the update body
        // needs a valid string, so send what we hold or nothing.
        phone: member.phone ?? '',
        email: member.email,
        active: !member.active,
      },
    });
  };

  const columns = useMemo<ColumnDef<Staff>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <div>
            <p className="text-ink font-semibold">{row.original.name}</p>
            <p className="text-muted text-xs">{row.original.email}</p>
          </div>
        ),
      },
      {
        accessorKey: 'role',
        header: 'Role',
        cell: ({ row }) => (
          <StatusChip tone={row.original.role === 'owner' ? 'ink' : 'neutral'}>
            {staffRoleLabel(row.original.role)}
          </StatusChip>
        ),
      },
      {
        accessorKey: 'phone',
        header: 'Phone',
        cell: ({ getValue }) => (
          <span className="tabular text-muted">{getValue<string | null>() ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'startedAt',
        header: 'Started',
        cell: ({ getValue }) => (
          <span className="text-muted tabular">{formatDay(getValue<string>())}</span>
        ),
      },
      {
        accessorKey: 'active',
        header: 'Status',
        cell: ({ row }) => (
          <label
            className="flex cursor-pointer items-center gap-2 text-xs font-semibold"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              className="accent-[var(--red)]"
              checked={row.original.active}
              onChange={() => toggleActive(row.original)}
              disabled={row.original.role === 'owner'}
            />
            {row.original.active ? 'Active' : 'Inactive'}
          </label>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              aria-label={`Edit ${row.original.name}`}
              onClick={() => {
                setEditing(row.original);
                setDialogOpen(true);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Team"
        title="Staff"
        description="Who works the counter and the bench."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus aria-hidden="true" />
            Add staff
          </Button>
        }
      />

      <div className="border-line bg-card text-muted mb-4 flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm">
        <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
        <p>
          Logins, permissions and per-staff PINs arrive with the auth phase — this is the roster.
        </p>
      </div>

      <DataTable
        data={staff}
        columns={columns}
        isLoading={isPending}
        isError={isError}
        errorMessage="The staff list didn’t load."
        onRetry={() => refetch()}
        searchPlaceholder="Search name or email…"
        empty={{ title: 'No staff yet', description: 'Add the first team member.' }}
        rowClassName={(member) => (member.active ? undefined : 'opacity-55')}
      />

      <StaffDialog
        key={editing?.id ?? 'new'}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        member={editing}
      />
    </div>
  );
}

/* ---- add / edit dialog ------------------------------------------------------ */

const staffFormSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name'),
  // Two roles, matching the database. The old four included three the server
  // has never accepted — picking one produced a 400 on save.
  role: z.enum(['owner', 'employee']),
  phone: z
    .string()
    .trim()
    .regex(/^(?:\+?44|0)[\d\s-]{9,13}$/, 'Enter a valid UK phone number'),
  email: z.string().trim().email('Enter a valid email'),
  active: z.boolean(),
  // Round 4 #BUG-12: create-only, and optional — blank means "the API
  // generates one". `.or(z.literal(''))` because an empty string is the
  // genuinely-blank case, not a validation failure; a non-empty value still
  // has to actually be long enough.
  password: z.string().min(8, 'At least 8 characters').or(z.literal('')),
});
type StaffFormValues = z.infer<typeof staffFormSchema>;

function StaffDialog({
  open,
  onOpenChange,
  member,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: Staff | null;
}) {
  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff();
  const pending = createStaff.isPending || updateStaff.isPending;

  // Round 4 #BUG-12: set only when a create response actually carries a
  // server-generated password (never for one the admin typed themselves —
  // they already have it) — see staffSchema.temporaryPassword's own
  // comment. Swaps the dialog body to the "copy this now" view instead of
  // closing; there is exactly one moment this value is ever available.
  const [revealed, setRevealed] = useState<{ name: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<StaffFormValues>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: member
      ? {
          name: member.name,
          role: member.role,
          phone: member.phone ?? '',
          email: member.email,
          active: member.active,
          password: '',
        }
      : { name: '', role: 'employee', phone: '', email: '', active: true, password: '' },
  });

  const submit = handleSubmit((values: StaffFormValues) => {
    if (member) {
      const { password: _password, ...input } = values;
      updateStaff.mutate(
        { id: member.id, input: { ...input, role: input.role as StaffRole } },
        { onSuccess: () => onOpenChange(false) },
      );
      return;
    }
    const input = {
      ...values,
      role: values.role as StaffRole,
      password: values.password || undefined,
    };
    createStaff.mutate(input, {
      onSuccess: (created) => {
        if (created.temporaryPassword) {
          setRevealed({ name: created.name, password: created.temporaryPassword });
        } else {
          onOpenChange(false);
        }
      },
    });
  });

  if (revealed) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{revealed.name} is on the roster</DialogTitle>
            <DialogDescription>
              Copy this password now and pass it to {revealed.name} — it’s shown once and never
              stored anywhere retrievable, not even here.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              readOnly
              value={revealed.password}
              className="tabular text-xs"
              aria-label="Temporary password"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(revealed.password);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => {
                setRevealed(null);
                setCopied(false);
                onOpenChange(false);
              }}
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{member ? 'Edit staff member' : 'Add staff'}</DialogTitle>
          <DialogDescription>
            {member ? `Editing ${member.name}.` : 'A new name for the rota.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Name" htmlFor="stf-name" error={errors.name?.message}>
            <Input id="stf-name" autoFocus {...register('name')} />
          </Field>
          <Field label="Role" htmlFor="stf-role">
            <Select id="stf-role" {...register('role')}>
              <option value="employee">Employee</option>
              <option value="owner">Admin</option>
            </Select>
          </Field>
          <Field label="Phone" htmlFor="stf-phone" error={errors.phone?.message}>
            <Input id="stf-phone" inputMode="tel" {...register('phone')} />
          </Field>
          {/*
            Email is the sign-in identity, so it can only be set when the
            account is created. Editing it here would need the auth account
            changed too, which the API doesn't do — leaving the field editable
            would just discard whatever was typed.
          */}
          <Field
            label="Email"
            htmlFor="stf-email"
            error={errors.email?.message}
            hint={member ? 'Sign-in email can’t be changed here.' : undefined}
          >
            <Input
              id="stf-email"
              type="email"
              readOnly={!!member}
              aria-readonly={!!member}
              className={member ? 'text-muted cursor-not-allowed' : undefined}
              {...register('email')}
            />
          </Field>
          {/* Round 4 #BUG-12: create-only — editing an existing account's
              password isn't something this endpoint does (same reasoning as
              email above). Leave blank to have the API generate one, shown
              once right after saving. */}
          {!member ? (
            <Field
              label="Password (optional)"
              htmlFor="stf-password"
              error={errors.password?.message}
              hint="Leave blank to generate one — you’ll get one chance to copy it."
            >
              <Input
                id="stf-password"
                type="password"
                autoComplete="new-password"
                placeholder="Auto-generate"
                {...register('password')}
              />
            </Field>
          ) : null}
          <label className="flex items-center gap-2.5 text-sm font-semibold">
            <input type="checkbox" className="accent-[var(--red)]" {...register('active')} />
            Active
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
              {pending ? 'Saving…' : member ? 'Save changes' : 'Add staff'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
