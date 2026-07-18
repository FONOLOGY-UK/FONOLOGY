import { Spinner } from '@/components/ui/spinner';

/** Root loading UI (shown during route segment transitions). */
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="size-8" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
