'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { SignInInput, SignUpInput } from '../types';
import { toast } from '@/lib/stores/toast.store';
import { queryKeys } from './query-keys';

/**
 * THE auth surface (item 9). Components only ever use these hooks; the mock
 * adapter fakes sessions in localStorage, and Raja's real implementation
 * (likely Supabase Auth) slots in behind the same DataAdapter methods.
 *
 * Customer accounts are OPTIONAL — no storefront flow is gated behind
 * `useSession()` returning a user.
 */

export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: () => dataAdapter.getSession(),
    staleTime: 60 * 1000,
  });
}

function useSessionMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>,
  successMessage?: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.session });
      if (successMessage) toast(successMessage);
    },
  });
}

export function useSignIn() {
  return useSessionMutation((input: SignInInput) => dataAdapter.signIn(input), 'Signed in');
}

export function useSignUp() {
  return useSessionMutation((input: SignUpInput) => dataAdapter.signUp(input), 'Account created');
}

export function useGoogleSignIn() {
  return useSessionMutation(() => dataAdapter.signInWithGoogle(), 'Signed in with Google');
}

export function useStaffSignIn() {
  return useSessionMutation((input: SignInInput) => dataAdapter.staffSignIn(input));
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) => dataAdapter.requestPasswordReset(email),
  });
}

export function useSignOut() {
  return useSessionMutation(() => dataAdapter.signOut(), 'Signed out');
}
