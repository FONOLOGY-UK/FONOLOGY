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

/**
 * Lock this device's staff session. The lock lives on the server, so the
 * session query is refetched rather than any local flag being flipped —
 * whatever the server says is the truth the screen renders.
 */
export function useLockSession() {
  return useSessionMutation(() => dataAdapter.lockStaffSession());
}

/**
 * Unlock with a PIN. No toast: a wrong PIN is shown on the keypad itself, and
 * the PIN is never retained anywhere after this call.
 */
export function useUnlockSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pin: string) => dataAdapter.unlockStaffSession(pin),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.session }),
  });
}

export function useSetStaffPin() {
  return useSessionMutation((pin: string) => dataAdapter.setStaffPin(pin), 'PIN updated');
}

export function useSignIn() {
  return useSessionMutation((input: SignInInput) => dataAdapter.signIn(input), 'Signed in');
}

export function useSignUp() {
  return useSessionMutation((input: SignUpInput) => dataAdapter.signUp(input), 'Account created');
}

/**
 * Google sign-in.
 *
 * On failure the message is shown, not swallowed. The provider is not
 * configured yet, and the adapter refuses before redirecting rather than
 * letting Supabase answer with raw JSON on its own domain — so `error.message`
 * here is already a sentence written for a customer.
 */
export function useGoogleSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => dataAdapter.signInWithGoogle(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.session });
      toast('Signed in with Google');
    },
    onError: (error) =>
      toast(error.message || 'Google sign-in isn’t available — please use your email address.'),
  });
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
