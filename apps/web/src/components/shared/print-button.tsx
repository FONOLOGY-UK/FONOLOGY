'use client';

import { useState } from 'react';
import { Printer } from 'lucide-react';
import { useEnqueuePrintJob, usePrintAgents } from '@/lib/data/hooks';
import type { PrintJobKind } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The one button that asks for a piece of paper.
 *
 * WHY THIS IS SHARED RATHER THAN WRITTEN FIVE TIMES
 * Five screens print (sale, refund, payout, job label, shelf label). The
 * enqueue call is trivial; what is NOT trivial is telling the truth about what
 * just happened, and five ad-hoc versions would word it five ways and get it
 * wrong in at least one.
 *
 * THE THING THIS EXISTS TO PREVENT
 * Enqueuing always succeeds. The queue is durable, so the API happily accepts
 * a job when the till PC is switched off, the printer is unplugged, or the
 * agent has never been installed. A button that says "Sent to the printer" in
 * that situation is lying to someone who is standing at a counter watching a
 * printer do nothing — and the next thing they do is press it again, then
 * assume the till is broken.
 *
 * So the button reads the agent's health BEFORE it speaks:
 *
 *   agent healthy   → "Sent to the printer."
 *   agent asleep    → queued, and says the till PC is off and it will print
 *                     when someone logs in
 *   agent down/none → queued, and says plainly that nothing is listening
 *
 * In every case the job is safely on the queue. The difference is entirely in
 * what the person is told, which is the part that decides whether they trust
 * the till tomorrow.
 *
 * DEDUPE
 * `dedupeKey` is caller-supplied and must be stable for the same piece of
 * paper — `sale-receipt-<saleId>` and not a timestamp — so a double-click is a
 * no-op rather than two receipts. The server returns the existing job and says
 * `duplicate: true`. Test prints are the deliberate exception: those are
 * timestamped, because running the same test twice is the point.
 */

/**
 * Icon-only shelf-label button for a table row.
 *
 * A row in a dense table has no space for a status line, so this reports
 * through the global toast instead of inline text. That is the one place the
 * honesty rule is relaxed — a shelf label is not a customer-facing document
 * and nobody is standing at a counter waiting for it, unlike a receipt.
 */
export function PrintLabelIconButton({
  product,
}: {
  product: { id: string; name: string; barcode?: string | null };
}) {
  const enqueue = useEnqueuePrintJob();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 px-2"
      aria-label={`Print shelf label for ${product.name}`}
      title="Print shelf label"
      disabled={enqueue.isPending}
      onClick={() =>
        enqueue.mutate({
          kind: 'shelf_label',
          entityId: product.id,
          dedupeKey: `shelf-label-${product.id}-${Date.now()}`,
        })
      }
    >
      <Printer className="size-3.5" />
    </Button>
  );
}

export function PrintButton({
  kind,
  entityId,
  dedupeKey,
  label = 'Print',
  variant = 'outline',
  size,
  className,
}: {
  kind: PrintJobKind;
  entityId: string;
  /** Stable per physical document. See the note above. */
  dedupeKey: string;
  label?: string;
  variant?: 'outline' | 'default' | 'ghost';
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const enqueue = useEnqueuePrintJob();
  const { data: agents } = usePrintAgents();
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  /**
   * The primary agent is the one that drains the queue. A non-primary or
   * revoked row is not going to print anything, so it must not count as
   * "someone is listening".
   */
  const primary = (agents ?? []).find((a) => a.isPrimary && !a.revokedAt);

  const onClick = () => {
    enqueue.mutate(
      { kind, entityId, dedupeKey },
      {
        onSuccess: (result) => {
          if (result.duplicate) {
            setNote({ text: 'Already sent — it is on the queue.', tone: 'ok' });
            return;
          }
          if (!primary || primary.health === 'never_seen' || primary.health === 'down') {
            setNote({
              text: 'Queued — but the till PC is not responding, so nothing will come out yet.',
              tone: 'warn',
            });
            return;
          }
          if (primary.health === 'asleep') {
            setNote({
              text: 'Queued — the till PC is off. It will print when someone logs in.',
              tone: 'warn',
            });
            return;
          }
          setNote({ text: 'Sent to the printer.', tone: 'ok' });
        },
        onError: (err) =>
          setNote({
            text: err instanceof Error ? err.message : 'Could not send that to the printer.',
            tone: 'warn',
          }),
      },
    );
  };

  return (
    <div className={cn('grid gap-1', className)}>
      <Button variant={variant} size={size} onClick={onClick} disabled={enqueue.isPending}>
        <Printer aria-hidden="true" />
        {enqueue.isPending ? 'Sending…' : label}
      </Button>
      {note ? (
        <p
          role="status"
          className={cn('text-xs', note.tone === 'warn' ? 'text-warning' : 'text-muted')}
        >
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
