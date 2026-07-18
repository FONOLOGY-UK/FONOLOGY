import { cn } from '@/lib/utils';

/** Ring spinner matching the prototype's pay-button spinner. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'border-red/30 border-t-red inline-block size-5 animate-[spin_.7s_linear_infinite] rounded-full border-[2.5px]',
        className,
      )}
    />
  );
}
