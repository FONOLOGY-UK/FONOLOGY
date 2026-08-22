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
      locked: false,
      lock: () => set({ locked: true }),
      unlock: () => set({ locked: false }),

      jobsView: 'board',
      setJobsView: (jobsView) => set({ jobsView }),

      floatPromptDismissedFor: null,
      dismissFloatPrompt: (staffId, day) => set({ floatPromptDismissedFor: `${staffId}:${day}` }),
    }),
    {
      name: 'fonology-admin',
      version: 1,
      // version bump: the old shape (`floatPromptDismissedOn`, day-only) is
      // exactly the bug above. zustand logs a loud console error on every
      // load if the version changed and no `migrate` is given — it does NOT
      // quietly fall back to the initial state the way the old comment here
      // assumed; it hands the OLD shape through as-is instead. This drops
      // the stale key explicitly rather than carrying it forward unused:
      // nobody has dismissed anything yet under the new, correct rule, so
      // returning `undefined` for it is the right answer, not an accident.
      migrate: (persisted) => {
        if (persisted && typeof persisted === 'object' && 'floatPromptDismissedOn' in persisted) {
          const { floatPromptDismissedOn: _drop, ...rest } = persisted as Record<string, unknown>;
          return rest;
        }
        return persisted;
      },
    },
  ),
);
