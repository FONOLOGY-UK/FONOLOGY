import { cn } from '@/lib/utils';

export type ChipTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'ink';

/**
 * Small status chip used across admin tables and cards. Tone + text carry the
 * state together (never colour alone).
 */
export function StatusChip({
  tone,
  children,
  className,
}: {
  tone: ChipTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.04em]',
        tone === 'neutral' && 'bg-paper-2 text-ink-2',
        tone === 'accent' && 'bg-red-tint text-red-deep',
        tone === 'success' && 'bg-success/10 text-success',
        tone === 'warning' && 'bg-warning/10 text-warning',
        tone === 'danger' && 'bg-red-deep text-white',
        tone === 'ink' && 'bg-ink text-bone',
        className,
      )}
    >
      {children}
    </span>
  );
}
