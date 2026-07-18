import Link from 'next/link';
import { Button } from '@/components/ui/button';

/** Root 404. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-display text-red text-sm font-bold uppercase tracking-[0.18em]">404</p>
      <h1 className="font-display text-5xl font-extrabold uppercase tracking-tight">
        Page not found.
      </h1>
      <p className="text-muted max-w-md">
        That page has wandered off. It happens. Let’s get you back on track.
      </p>
      <div className="mt-2 flex gap-3">
        <Button asChild>
          <Link href="/">Back home</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/shop">Browse the shop</Link>
        </Button>
      </div>
    </main>
  );
}
