'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRequestPasswordReset } from '@/lib/data/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/admin/field';
import { AuthCard } from './auth-bits';

const forgotSchema = z.object({ email: z.string().trim().email('Enter a valid email address') });
type ForgotValues = z.infer<typeof forgotSchema>;

export function ForgotView() {
  const reset = useRequestPasswordReset();
  const [sentTo, setSentTo] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotValues>({ resolver: zodResolver(forgotSchema) });

  const submit = handleSubmit((values) =>
    reset.mutate(values.email, { onSuccess: () => setSentTo(values.email) }),
  );

  if (sentTo) {
    return (
      <AuthCard eyebrow="Reset link sent" title={<>Check your inbox.</>}>
        <div className="flex items-start gap-2.5">
          <MailCheck className="text-success mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-ink-2 text-sm leading-relaxed">
            If <strong>{sentTo}</strong> has an account, a reset link is on its way. Give it a
            minute, and check spam before trying again.
          </p>
        </div>
        <Button asChild variant="outline" className="h-12 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard eyebrow="It happens" title={<>Forgot your password.</>}>
      <p className="text-muted -mt-1 text-sm">Enter your email and we’ll send a reset link.</p>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <Field label="Email" htmlFor="fp-email" error={errors.email?.message}>
          <Input
            id="fp-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.co.uk"
            className="h-12"
            {...register('email')}
          />
        </Field>
        <Button type="submit" size="lg" className="h-12 w-full" disabled={reset.isPending}>
          {reset.isPending ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
      <p className="text-muted text-center text-[13px]">
        Remembered it?{' '}
        <Link href="/login" className="hover:text-red underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
