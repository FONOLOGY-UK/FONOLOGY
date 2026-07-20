'use client';

import { useRouter } from 'next/navigation';
import { AlertTriangle, Wrench } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useStaffSignIn } from '@/lib/data/hooks';
import { signInInputSchema, type SignInInput } from '@/lib/data/types';
import { can } from '@/lib/permissions.config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/admin/field';
import { AuthCard } from './auth-bits';

/**
 * Staff sign-in (item 9) — a separate door for the team. Routes by role:
 * managers land on the admin dashboard, counter staff land on the till.
 */
export function StaffLoginView() {
  const router = useRouter();
  const staffSignIn = useStaffSignIn();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInInput>({ resolver: zodResolver(signInInputSchema) });

  const submit = handleSubmit((values) =>
    staffSignIn.mutate(values, {
      onSuccess: (user) => {
        const role = user.staffRole ?? 'counter';
        router.push(can(role, 'analytics.view') ? '/admin' : '/pos');
      },
    }),
  );

  return (
    <AuthCard
      eyebrow="Back of house"
      title={
        <span className="flex items-center gap-2.5">
          <Wrench className="text-red size-6" aria-hidden="true" />
          Staff sign in.
        </span>
      }
    >
      <p className="text-muted -mt-1 text-sm">
        Managers land on the dashboard, counter staff on the till.
      </p>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <Field label="Work email" htmlFor="sl-email" error={errors.email?.message}>
          <Input
            id="sl-email"
            type="email"
            autoComplete="email"
            placeholder="you@fonology.co.uk"
            className="h-12"
            {...register('email')}
          />
        </Field>
        <Field label="Password" htmlFor="sl-password" error={errors.password?.message}>
          <Input
            id="sl-password"
            type="password"
            autoComplete="current-password"
            className="h-12"
            {...register('password')}
          />
        </Field>
        {staffSignIn.isError ? (
          <p className="text-red-deep flex items-start gap-1.5 text-sm font-semibold" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {staffSignIn.error.message}
          </p>
        ) : null}
        <Button type="submit" size="lg" className="h-12 w-full" disabled={staffSignIn.isPending}>
          {staffSignIn.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="text-muted/70 text-center text-xs">
        Demo build — any roster email works, e.g. tanoli@fonology.co.uk (owner) or
        sana@fonology.co.uk (counter), any 8+ character password.
      </p>
    </AuthCard>
  );
}
