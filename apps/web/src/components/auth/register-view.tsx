'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useGoogleSignIn, useSignUp } from '@/lib/data/hooks';
import { signUpInputSchema, type SignUpInput } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/admin/field';
import { AuthCard, AuthDivider, GoogleButton, OptionalNotice } from './auth-bits';

export function RegisterView() {
  const router = useRouter();
  const signUp = useSignUp();
  const google = useGoogleSignIn();
  const pending = signUp.isPending || google.isPending;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpInput>({ resolver: zodResolver(signUpInputSchema) });

  const done = { onSuccess: () => router.push('/') };
  const submit = handleSubmit((values) => signUp.mutate(values, done));

  return (
    <AuthCard eyebrow="New here" title={<>Create an account.</>}>
      <OptionalNotice />
      <GoogleButton
        onClick={() => google.mutate(undefined, done)}
        disabled={pending}
        label="Sign up with Google"
      />
      <AuthDivider />
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <Field label="Name" htmlFor="re-name" error={errors.name?.message}>
          <Input
            id="re-name"
            autoComplete="name"
            placeholder="Your name"
            className="h-12"
            {...register('name')}
          />
        </Field>
        <Field label="Email" htmlFor="re-email" error={errors.email?.message}>
          <Input
            id="re-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.co.uk"
            className="h-12"
            {...register('email')}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="re-password"
          error={errors.password?.message}
          hint="At least 8 characters"
        >
          <Input
            id="re-password"
            type="password"
            autoComplete="new-password"
            className="h-12"
            {...register('password')}
          />
        </Field>
        <Button type="submit" size="lg" className="h-12 w-full" disabled={pending}>
          {signUp.isPending ? 'Creating…' : 'Create account'}
        </Button>
      </form>
      <p className="text-muted text-center text-[13px]">
        Already got one?{' '}
        <Link href="/login" className="hover:text-red underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
