import type { ReactNode } from 'react';

/**
 * AUTH shell (route group — adds no URL segment).
 *
 * PHASE 1 = STRUCTURE ONLY. Neutral centred wrapper so login / register /
 * forgot-password / staff-login routes render. Design authority for these
 * pages is ours, but the actual auth page design + forms (React Hook Form +
 * Zod, wired to Raja's auth) are built in a later phase.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-paper text-ink flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
