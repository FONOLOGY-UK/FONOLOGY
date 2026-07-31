import { Skeleton } from '@/components/ui/skeleton';

/**
 * Suspense fallback for a dashboard page.
 *
 * Every admin page that renders a client component calling
 * `useSearchParams()` needs a REAL fallback, not a bare `<Suspense>`.
 * `useSearchParams()` makes the component bail out of prerendering by
 * suspending; with `fallback={undefined}` there is nothing to render in its
 * place and the subtree never resumes on a direct load — the page sits on
 * skeletons forever, and any query the component owns never even registers.
 *
 * It only bites when `useSearchParams()` is the first hook in the component
 * that also owns the page's data query (as on Inventory). Where the call is
 * nested a level down — RangePicker on Overview, Reports and Payments — the
 * parent's hooks have already run and the page survives by luck. Giving every
 * one of them a fallback removes the luck.
 */
export function PageLoading() {
  return (
    <div className="grid gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-24" />
      <Skeleton className="h-64" />
    </div>
  );
}
