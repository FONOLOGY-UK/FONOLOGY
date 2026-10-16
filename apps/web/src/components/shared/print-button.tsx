'use client';

import { useState } from 'react';
import { Printer } from 'lucide-react';
import { useEnqueuePrintJob, usePrintStatus } from '@/lib/data/hooks';
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
  /**
   * Optional because `day_report` (item 7) has no entity — the day is not a
   * row. Every other kind still names the thing it is printing.
   */
  entityId?: string;
  /** Stable per physical document. See the note above. */
  dedupeKey: string;
  label?: string;
  variant?: 'outline' | 'default' | 'ghost';
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const enqueue = useEnqueuePrintJob();
  // GET /print/status, readable by anyone who can print. (It used to read the owner-only agents list,
  // which answered 403 for everyone else and made this button cry wolf on every press.)
  const { data: status } = usePrintStatus();
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  /**
   * The server judges this against the shop's primary agent only — a non-primary or revoked agent is
   * not going to print anything, so it never counts as "someone is listening".
   *
   * When we cannot tell (the check has not loaded or failed, or "All shops" is selected) the button
   * says nothing alarming: the job IS safely on the queue, and a warning that might be false is the
   * exact thing this component exists to avoid.
   */
  const health = status?.health ?? null;

  const onClick = () => {
    enqueue.mutate(
      { kind, entityId, dedupeKey },
      {
        onSuccess: (result) => {
          if (result.duplicate) {
            setNote({ text: 'Already sent — it is on the queue.', tone: 'ok' });
            return;
          }
          if (health === 'no_agent') {
            setNote({
              text: 'Queued — but no till PC is set up to print yet, so nothing will come out.',
              tone: 'warn',
            });
            return;
          }
          if (health === 'never_seen' || health === 'down') {
            setNote({
              text: 'Queued — but the till PC is not responding, so nothing will come out yet.',
              tone: 'warn',
            });
            return;
          }
          if (health === 'asleep') {
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
