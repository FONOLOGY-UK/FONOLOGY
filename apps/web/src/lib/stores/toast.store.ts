'use client';

import { create } from 'zustand';

export interface Toast {
  id: string;
  /** Plain text, or text with a single **highlight** — see Toaster rendering. */
  message: string;
  /** Auto-dismiss delay in ms. */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, options?: { duration?: number }) => string;
  dismiss: (id: string) => void;
}

/**
 * Bespoke toast system styled to the prototype's `.toast` (ink pill, bottom
 * centre). Shared across all surfaces. Imperative API via `toast()` below.
 */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, options) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const duration = options?.duration ?? 2600;
    set((state) => ({ toasts: [...state.toasts, { id, message, duration }] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Fire a toast from anywhere (event handlers, mutations). */
export function toast(message: string, options?: { duration?: number }): string {
  return useToastStore.getState().push(message, options);
}
