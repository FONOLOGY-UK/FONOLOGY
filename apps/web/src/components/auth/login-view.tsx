'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useGoogleSignIn, useSignIn } from '@/lib/data/hooks';
import { signInInputSchema, type SignInInput } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/admin/field';
import { AuthCard, AuthDivider, GoogleButton, OptionalNotice } from './auth-bits';

export function LoginView() {
  const router = useRouter();
  const signIn = useSignIn();
  const google = useGoogleSignIn();
  const pending = signIn.isPending || google.isPending;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInInput>({ resolver: zodResolver(signInInputSchema) });

  const done = { onSuccess: () => router.push('/') };
  const submit = handleSubmit((values) => signIn.mutate(values, done));

  return (
    <AuthCard eyebrow="Welcome back" title={<>Sign in.</>}>
      <OptionalNotice />
      <GoogleButton onClick={() => google.mutate(undefined, done)} disabled={pending} />
      <AuthDivider />
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <Field label="Email" htmlFor="li-email" error={errors.email?.message}>
          <Input
            id="li-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.co.uk"
            className="h-12"
            {...register('email')}
          />
        </Field>
        <Field label="Password" htmlFor="li-password" error={errors.password?.message}>
          <Input
            id="li-password"
            type="password"
            autoComplete="current-password"
            className="h-12"
            {...register('password')}
          />
        </Field>
        <Button type="submit" size="lg" className="h-12 w-full" disabled={pending}>
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <div className="text-muted flex items-center justify-between text-[13px]">
        <Link href="/forgot-password" className="hover:text-red underline underline-offset-2">
          Forgot password?
        </Link>
        <Link href="/register" className="hover:text-red underline underline-offset-2">
          Create an account
        </Link>
      </div>
    </AuthCard>
  );
}
