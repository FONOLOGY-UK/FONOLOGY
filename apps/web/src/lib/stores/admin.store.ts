'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Admin UI state (item 7). The PIN lock is a SCREEN LOCK — an overlay above
 * the dashboard. Locking never unmounts pages, never ends the session and
 * never loses in-progress work; it only covers the screen until the PIN is
 * entered. (Real authentication is item 9 / Raja's backend.)
 */

interface AdminState {
  /** Whether the lock overlay is covering the dashboard. Survives refresh. */
  locked: boolean;
  lock: () => void;
  unlock: () => void;

  /** Jobs module view preference. */
  jobsView: 'board' | 'table';
  setJobsView: (view: 'board' | 'table') => void;

  /** ISO day ("YYYY-MM-DD") the float prompt was last dismissed on. */
  floatPromptDismissedOn: string | null;
  dismissFloatPrompt: (day: string) => void;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set) => ({
      locked: false,
      lock: () => set({ locked: true }),
      unlock: () => set({ locked: false }),

      jobsView: 'board',
      setJobsView: (jobsView) => set({ jobsView }),

      floatPromptDismissedOn: null,
      dismissFloatPrompt: (day) => set({ floatPromptDismissedOn: day }),
    }),
    { name: 'fonology-admin' },
  ),
);
