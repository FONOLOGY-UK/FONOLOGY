'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/** Root route-error boundary (Next.js). */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-display text-red text-sm font-bold uppercase tracking-[0.18em]">
        Something broke
      </p>
      <h1 className="font-display text-4xl font-extrabold uppercase tracking-tight">
        Well, that’s embarrassing.
      </h1>
      <p className="text-muted max-w-md">
        An unexpected error occurred. Try again, or head back to the homepage.
      </p>
      <div className="mt-2 flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/">Back home</Link>
        </Button>
      </div>
    </main>
  );
}
