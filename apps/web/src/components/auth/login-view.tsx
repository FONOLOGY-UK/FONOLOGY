'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useGoogleSignIn, useSignIn } from '@/lib/data/hooks';
import { signInInputSchema, type SignInInput } from '@/lib/data/types';
import { Field } from '@/components/admin/field';
import {
  AuthCard,
  AuthDivider,
  AuthInput,
  AuthPasswordInput,
  AuthSubmit,
  GoogleButton,
  OptionalNotice,
} from './auth-bits';

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
      {google.error ? (
        <p className="text-red-deep mt-2 text-sm" role="status">
          {google.error.message}
        </p>
      ) : null}
      <AuthDivider />
      <form onSubmit={submit} className="grid gap-3.5" noValidate>
        <Field label="Email" htmlFor="li-email" error={errors.email?.message}>
          <AuthInput
            id="li-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.co.uk"
            {...register('email')}
          />
        </Field>
        <Field label="Password" htmlFor="li-password" error={errors.password?.message}>
          <AuthPasswordInput
            id="li-password"
            autoComplete="current-password"
            {...register('password')}
          />
        </Field>
        <AuthSubmit pending={pending} pendingLabel="Signing in…">
          Sign in
        </AuthSubmit>
      </form>
      <div className="auth-meta">
        <Link href="/forgot-password">Forgot password?</Link>
        <Link href="/register">Create an account</Link>
      </div>
    </AuthCard>
  );
}
