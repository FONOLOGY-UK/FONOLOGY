'use client';

import { useRouter } from 'next/navigation';
import { AlertTriangle, Wrench } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useStaffSignIn } from '@/lib/data/hooks';
import { signInInputSchema, type SignInInput } from '@/lib/data/types';
import { can } from '@/lib/permissions.config';
import { Field } from '@/components/admin/field';
import { AuthCard, AuthInput, AuthPasswordInput, AuthSubmit } from './auth-bits';

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
        const role = user.staffRole ?? 'employee';
        router.push(can(role, 'analytics.view', user.permissions) ? '/admin' : '/pos');
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
      <form onSubmit={submit} className="grid gap-3.5" noValidate>
        <Field label="Work email" htmlFor="sl-email" error={errors.email?.message}>
          <AuthInput
            id="sl-email"
            type="email"
            autoComplete="email"
            placeholder="you@fonology.co.uk"
            {...register('email')}
          />
        </Field>
        <Field label="Password" htmlFor="sl-password" error={errors.password?.message}>
          <AuthPasswordInput
            id="sl-password"
            autoComplete="current-password"
            {...register('password')}
          />
        </Field>
        {staffSignIn.isError ? (
          <p className="text-red-deep flex items-start gap-1.5 text-sm font-semibold" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {staffSignIn.error.message}
          </p>
        ) : null}
        <AuthSubmit pending={staffSignIn.isPending} pendingLabel="Signing in…">
          Sign in
        </AuthSubmit>
      </form>
      <p className="text-muted/70 text-center text-xs">
        Sign in with your Fonology work email and password.
      </p>
    </AuthCard>
  );
}
