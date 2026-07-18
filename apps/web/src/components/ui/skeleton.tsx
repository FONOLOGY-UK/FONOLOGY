import { cn } from '@/lib/utils';

/** Loading placeholder. Shared primitive — used while queries are pending. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-ui bg-paper-2/70 animate-pulse', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

export { Skeleton };
