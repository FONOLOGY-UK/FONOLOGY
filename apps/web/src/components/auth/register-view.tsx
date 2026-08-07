'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useGoogleSignIn, useSignUp } from '@/lib/data/hooks';
import { signUpInputSchema, type SignUpInput } from '@/lib/data/types';
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

/** `redirectTo` is sanitised by the page — see the note on LoginView. */
export function RegisterView({ redirectTo = '/' }: { redirectTo?: string }) {
  const router = useRouter();
  const signUp = useSignUp();
  const google = useGoogleSignIn();
  const pending = signUp.isPending || google.isPending;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpInput>({ resolver: zodResolver(signUpInputSchema) });

  const done = { onSuccess: () => router.push(redirectTo) };
  const submit = handleSubmit((values) => signUp.mutate(values, done));

  const loginHref =
    redirectTo === '/' ? '/login' : `/login?redirect=${encodeURIComponent(redirectTo)}`;

  return (
    <AuthCard eyebrow="New here" title={<>Create an account.</>}>
      <OptionalNotice />
      <GoogleButton
        onClick={() => google.mutate(undefined, done)}
        disabled={pending}
        label="Sign up with Google"
      />
      {google.error ? (
        <p className="text-red-deep mt-2 text-sm" role="status">
          {google.error.message}
        </p>
      ) : null}
      <AuthDivider />
      <form onSubmit={submit} className="grid gap-3.5" noValidate>
        <Field label="Name" htmlFor="re-name" error={errors.name?.message}>
          <AuthInput
            id="re-name"
            autoComplete="name"
            placeholder="Your name"
            {...register('name')}
          />
        </Field>
        <Field label="Email" htmlFor="re-email" error={errors.email?.message}>
          <AuthInput
            id="re-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.co.uk"
            {...register('email')}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="re-password"
          error={errors.password?.message}
          hint="At least 8 characters"
        >
          <AuthPasswordInput
            id="re-password"
            autoComplete="new-password"
            {...register('password')}
          />
        </Field>
        <AuthSubmit pending={pending} pendingLabel="Creating…">
          Create account
        </AuthSubmit>
      </form>
      <p className="auth-meta auth-meta--center">
        <span>
          Already got one? <Link href={loginHref}>Sign in</Link>
        </span>
      </p>
    </AuthCard>
  );
}
