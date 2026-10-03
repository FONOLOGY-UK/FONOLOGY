'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Admin UI state kept in the browser. (The screen lock is NOT here — it lives
 * on the server, in `staff_sessions.locked`.)
 */

interface AdminState {
  /** Jobs module view preference. */
  jobsView: 'board' | 'table';
  setJobsView: (view: 'board' | 'table') => void;

  /**
   * `"${staffId}:${day}"` the float prompt was last dismissed for.
   *
   * BUG (found in QA regression testing): this used to be just the day,
   * with no staff id. On a real till — one shared machine, several people
   * signing in and out across a shift — whichever employee dismissed it
   * first silently spoke for everyone else for the rest of the day, even
   * though nobody else had touched it and no float had actually been
   * recorded. Keying by person as well as day means each staff member gets
   * asked once, not "whoever happened to go first."
   */
  floatPromptDismissedFor: string | null;
  dismissFloatPrompt: (staffId: string, day: string) => void;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set) => ({
      jobsView: 'board',
      setJobsView: (jobsView) => set({ jobsView }),

      floatPromptDismissedFor: null,
      dismissFloatPrompt: (staffId, day) => set({ floatPromptDismissedFor: `${staffId}:${day}` }),
    }),
    {
      name: 'fonology-admin',
      version: 2,
      // zustand hands an OLD persisted shape through as-is on a version change,
      // so drop the keys that no longer exist: `floatPromptDismissedOn` (the
      // day-only key behind the bug above) and `locked` (the lock is
      // server-side now; a stale `true` must not survive).
      migrate: (persisted) => {
        if (persisted && typeof persisted === 'object') {
          const {
            floatPromptDismissedOn: _day,
            locked: _locked,
            lock: _lock,
            unlock: _unlock,
            ...rest
          } = persisted as Record<string, unknown>;
          return rest;
        }
        return persisted;
      },
    },
  ),
);
