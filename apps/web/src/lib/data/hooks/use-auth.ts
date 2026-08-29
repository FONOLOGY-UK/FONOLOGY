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
 *
 * Round 4 #BUG-01: `mutationFn` takes the destination (`redirectTo`) as its
 * variable, not a lifecycle callback — the caller passes it as
 * `google.mutate(redirectTo)`. Resolving does NOT mean "signed in": for the
 * real adapter it means "a full-page redirect to Google is now in flight",
 * and `result.redirecting` is what tells `onSuccess` here (and the caller's
 * own success handler, if it checks the same flag) not to treat a kicked-off
 * redirect as a completed sign-in. Only mock mode's synchronous demo login
 * resolves with `redirecting: false`, and only then does this actually
 * invalidate the session / show the toast — the real completion, for the
 * real adapter, happens once on `/auth/callback` (google-callback-view.tsx),
 * after the browser is actually back with a real token to exchange.
 */
export function useGoogleSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (redirectTo?: string) => dataAdapter.signInWithGoogle(redirectTo),
    onSuccess: (result) => {
      if (result.redirecting) return;
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

/**
 * Round 5 Phase 2 #4 — the caller's own auto-lock override. Invalidates the
 * session (same as every other self-settings mutation here) so
 * `session.idleLockMinutes` — what pos-shell/admin-shell's idle timer
 * actually reads — updates immediately, without a reload.
 */
export function useSetOwnIdleLock() {
  return useSessionMutation(
    (idleLockMinutes: number | null) => dataAdapter.setOwnIdleLock(idleLockMinutes),
    'Auto-lock updated',
  );
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) => dataAdapter.requestPasswordReset(email),
  });
}

export function useSignOut() {
  return useSessionMutation(() => dataAdapter.signOut(), 'Signed out');
}

/**
 * Round 5 #30 — the checkout's "save my information" checkbox. `enabled`
 * defaults to true but the caller (checkout-flow.tsx) always passes
 * `session?.kind === 'customer'` explicitly: this must never fire for a
 * guest, both because there's nothing to fetch (no account, no saved row)
 * and because the endpoint would just 401.
 */
export function useCustomerAddress(enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.customerAddress,
    queryFn: () => dataAdapter.getCustomerAddress(),
    enabled,
  });
}

export function useSaveCustomerAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { address: string; postcode: string }) =>
      dataAdapter.saveCustomerAddress(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customerAddress });
    },
    // Deliberately silent on failure — this fires alongside placing an
    // order, and a customer whose card was just charged should never see
    // an error about something as low-stakes as an address not saving.
    onError: () => undefined,
  });
}
