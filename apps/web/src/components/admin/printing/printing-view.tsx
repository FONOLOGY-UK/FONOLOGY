'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Moon, Printer, RefreshCw, Tag, XCircle } from 'lucide-react';
import {
  useAdminProducts,
  useEnqueuePrintJob,
  usePrintAgents,
  usePrintQueue,
  useResolvePrintJob,
} from '@/lib/data/hooks';
import {
  agentHealthLabel,
  printKindLabel,
  sinceLabel,
  type PrintAgent,
  type PrintDevice,
  type PrintJob,
  type PrintTestVariant,
} from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { cn } from '@/lib/utils';

/**
 * Printers — health, the queue, and the test prints.
 *
 * WHO THIS SCREEN IS FOR
 * A shop owner, and sometimes a counter employee with a customer waiting. It is
 * written for someone who cannot debug anything and cannot call anybody. So:
 *
 *   - No status codes. `unconfirmed` never appears on screen; the question
 *     "Did this come out?" does, with two buttons.
 *   - "Asleep — shop is closed" rather than a red alarm out of hours. The
 *     server decides that against the owner's own opening hours; a screen that
 *     cries wolf every night is a screen nobody reads on Saturday.
 *   - The jobs that need a human are at the TOP and shown by default. A list of
 *     a hundred successful receipts buries the one row that matters.
 *
 * THERE IS NO CASH DRAWER. Confirmed with the shop — the till has no electronic
 * drawer, so there is no kick button here and none is coming. `kickDrawer()` in
 * lib/print/print-service.ts stays a documented no-op.
 */

/* ==========================================================================
 * Test prints
 * ======================================================================== */

/**
 * The five diagnostics, in the order a person should run them.
 *
 * Each one is designed so that a PHOTOGRAPH settles a question that cannot be
 * answered from here — see the agent's render/receipt.ts. The wording below is
 * what a shop employee reads, so it says what to look at rather than what is
 * being tested.
 */
const TESTS: {
  variant: PrintTestVariant;
  title: string;
  blurb: string;
  needsProduct: boolean;
  target: 'receipt' | 'label';
}[] = [
  {
    variant: 'width',
    title: '1. Paper width',
    blurb:
      'Checks the receipt paper is as wide as we think. Look for the arrow reaching the right edge.',
    needsProduct: false,
    target: 'receipt',
  },
  {
    variant: 'cut',
    title: '2. The cutter',
    blurb: 'Should give you two separate slips. One long strip means the cutter is not working.',
    needsProduct: false,
    target: 'receipt',
  },
  {
    variant: 'encoding',
    title: '3. Characters',
    blurb: 'Checks the pound sign and accented names print properly.',
    needsProduct: false,
    target: 'receipt',
  },
  {
    variant: 'barcode',
    title: '4. Barcode on a receipt',
    blurb: 'Prints a real product barcode. Scan it on the till — it must find that product.',
    needsProduct: true,
    target: 'receipt',
  },
  {
    variant: 'label',
    title: '5. Label printer',
    // Shares the product chosen for test 4 on purpose: running both tests
    // against the SAME known-good answer is what makes the pair meaningful —
    // if one printer's barcode scans and the other's does not, the difference
    // is the printer and not the product.
    blurb:
      'Prints a bordered label with the same product’s barcode. Check all four corners are on the label.',
    needsProduct: true,
    target: 'label',
  },
];

/* ==========================================================================
 * Device + agent health
 * ======================================================================== */

const TONE_CLASS: Record<'ok' | 'warn' | 'bad' | 'muted', string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-500',
  bad: 'text-red-700 dark:text-red-400',
  muted: 'text-muted',
};

function ToneIcon({ tone }: { tone: 'ok' | 'warn' | 'bad' | 'muted' }) {
  const Icon =
    tone === 'ok'
      ? CheckCircle2
      : tone === 'bad'
        ? XCircle
        : tone === 'warn'
          ? AlertTriangle
          : Moon;
  return <Icon className={cn('size-4 shrink-0', TONE_CLASS[tone])} aria-hidden />;
}

/**
 * One row per physical printer — the two devices the shop actually has.
 *
 * Rendered from a fixed list of the two targets rather than from whatever the
 * agent happened to report, so a printer that has NEVER reported still gets a
 * row saying so. Rendering only what was reported would make a printer the
 * agent cannot see disappear from the screen entirely, which reads as "fine".
 */
function DeviceRow({
  target,
  device,
  agent,
}: {
  target: 'receipt' | 'label';
  device: PrintDevice | undefined;
  agent: PrintAgent | undefined;
}) {
  const name = target === 'receipt' ? 'Receipt printer' : 'Label printer';
  const model = target === 'receipt' ? 'eposnow POS80GXa' : 'Brother QL-600';
  const Icon = target === 'receipt' ? Printer : Tag;

  // The agent is how we hear about the printer at all. If it is not talking,
  // the printer's last known state is not news — say that instead of showing a
  // stale green tick.
  const agentQuiet = !agent || agent.health === 'down' || agent.health === 'never_seen';
  const agentAsleep = agent?.health === 'asleep';

  let tone: 'ok' | 'warn' | 'bad' | 'muted';
  let text: string;
  if (agentAsleep) {
    tone = 'muted';
    text = 'Asleep — shop is closed';
  } else if (agentQuiet) {
    tone = 'bad';
    text = 'No answer from the till PC';
  } else if (!device) {
    tone = 'warn';
    text = 'Not reported yet';
  } else if (device.status === 'ok') {
    tone = 'ok';
    text = 'Ready';
  } else if (device.status === 'warning') {
    tone = 'warn';
    text = 'Needs a look';
  } else {
    tone = 'bad';
    text = 'Not working';
  }

  return (
    <div className="border-line flex items-start gap-3 border-b p-4 last:border-b-0">
      <Icon className="text-muted mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{name}</p>
        <p className="text-muted text-xs">{model}</p>
        {device?.detail ? (
          <p className="text-muted mt-1 break-words text-xs">{device.detail}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        <span
          className={cn('flex items-center gap-1.5 text-[13px] font-semibold', TONE_CLASS[tone])}
        >
          <ToneIcon tone={tone} />
          {text}
        </span>
        {device ? (
          <span className="text-muted text-xs">
            checked {sinceLabel(agent?.secondsSinceSeen ?? null)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ==========================================================================
 * Queue
 * ======================================================================== */

/**
 * A job waiting on a person.
 *
 * THE `unconfirmed` QUESTION IS THE WHOLE POINT OF THIS ROW. The agent got
 * bytes as far as the printer and then lost contact, so nobody can tell whether
 * paper came out — and a receipt is never reprinted automatically, because two
 * receipts for one sale is what a fraudulent return looks like. So a human is
 * asked, in words, with the two answers as buttons.
 */
function QueueRow({ job }: { job: PrintJob }) {
  const resolve = useResolvePrintJob();
  const waiting = job.status === 'unconfirmed';
  const failed = job.status === 'failed';

  return (
    <div className="border-line border-b p-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">
            {printKindLabel(job.kind)}
            <span className="text-muted font-normal">
              {' · '}
              {job.target === 'receipt' ? 'receipt printer' : 'label printer'}
            </span>
          </p>
          <p className="text-muted text-xs">
            {new Date(job.createdAt).toLocaleString('en-GB', {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
            {job.requestedByName ? ` · ${job.requestedByName}` : ''}
            {job.attempts > 1 ? ` · tried ${job.attempts} times` : ''}
          </p>
        </div>
        {!waiting && !failed ? (
          <span className="text-muted text-xs font-semibold">
            {job.status === 'printed'
              ? 'Printed'
              : job.status === 'queued'
                ? 'Waiting for the printer'
                : 'Printing now'}
          </span>
        ) : null}
      </div>

      {waiting ? (
        <div className="border-line-strong mt-3 rounded-md border border-dashed p-3">
          {/* Plain words, not a status code. This is read at a counter. */}
          <p className="text-[13px] font-semibold">Did this receipt come out of the printer?</p>
          <p className="text-muted mt-0.5 text-xs">
            We lost contact with the printer part-way through, so we cannot tell.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ id: job.id, outcome: 'printed' })}
            >
              Yes, it printed
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ id: job.id, outcome: 'reprint' })}
            >
              No — print it again
            </Button>
          </div>
        </div>
      ) : null}

      {failed ? (
        <div className="border-line-strong mt-3 rounded-md border border-dashed p-3">
          <p className="text-[13px] font-semibold">This did not print.</p>
          {job.lastError ? (
            <p className="text-muted mt-0.5 break-words text-xs">{job.lastError}</p>
          ) : null}
          <div className="mt-3">
            <Button
              size="sm"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ id: job.id, outcome: 'reprint' })}
            >
              Try again
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function PrintingView() {
  const [showAll, setShowAll] = useState(false);
  const [productId, setProductId] = useState('');
  const agents = usePrintAgents();
  const queue = usePrintQueue({ attention: !showAll });
  const enqueue = useEnqueuePrintJob();
  const products = useAdminProducts();

  // Only products that actually carry a barcode. The API refuses the scannable
  // test variants for a product without one — offering it in the list would be
  // offering a choice that always fails. Retired products are excluded too
  // (BUG-15-followup #9, same bug already fixed once on POS) — printing a
  // fresh test label for something no longer stocked isn't a real test.
  const scannable = (products.data ?? []).filter((p) => p.barcode && p.isActive !== false);

  // The primary agent is the one that drains the queue; a second install is a
  // problem to report, not a second set of printers to show.
  const primary = agents.data?.find((a) => a.isPrimary && !a.revokedAt) ?? agents.data?.[0];
  const conflicted = (agents.data ?? []).filter((a) => a.instanceConflictAt && !a.revokedAt);

  return (
    <div className="grid gap-4">
      <PageHeader
        eyebrow="Hardware"
        title="Printers"
        description="The receipt and label printers in the shop, and anything waiting to print."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void agents.refetch();
              void queue.refetch();
            }}
          >
            <RefreshCw className="size-4" aria-hidden />
            Refresh
          </Button>
        }
      />

      {/* Two installs sharing one token means two agents draining one queue,
          which is how a receipt gets printed twice. Loud, and above everything
          else on the screen. */}
      {conflicted.length > 0 ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-[13px] font-semibold text-red-800 dark:text-red-300">
            The same printer setup is running on more than one computer.
          </p>
          <p className="mt-1 text-xs text-red-700 dark:text-red-400">
            Receipts could print twice. Leave it running on the till PC only, and turn it off on the
            other machine.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---- Devices -------------------------------------------------- */}
        <section className="border-line bg-card rounded-lg border">
          <header className="border-line border-b px-4 py-3">
            <h2 className="text-sm font-semibold">The two printers</h2>
            {primary ? (
              <p className="text-muted mt-0.5 text-xs">
                {primary.name} · {agentHealthLabel(primary).text} · last heard from{' '}
                {sinceLabel(primary.secondsSinceSeen)}
                {primary.agentVersion ? ` · v${primary.agentVersion}` : ''}
              </p>
            ) : null}
          </header>
          {agents.isPending ? (
            <div className="grid gap-3 p-4">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : agents.isError ? (
            <div className="p-4">
              <EmptyState
                title="Could not read the printers"
                description="The dashboard could not reach the server. Try Refresh."
              />
            </div>
          ) : !primary ? (
            <div className="p-4">
              <EmptyState
                title="No printer setup registered yet"
                description="The shop's till PC has not been connected. Set it up in Settings once the print agent is installed."
              />
            </div>
          ) : (
            <>
              <DeviceRow
                target="receipt"
                device={primary.devices.find((d) => d.target === 'receipt')}
                agent={primary}
              />
              <DeviceRow
                target="label"
                device={primary.devices.find((d) => d.target === 'label')}
                agent={primary}
              />
            </>
          )}
        </section>

        {/* ---- Test prints ---------------------------------------------- */}
        <section className="border-line bg-card rounded-lg border">
          <header className="border-line border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Test prints</h2>
            <p className="text-muted mt-0.5 text-xs">
              Run these once when the printers are first set up, and photograph what comes out.
            </p>
          </header>
          <div className="grid gap-3 p-4">
            {TESTS.map((test) => (
              <div key={test.variant} className="border-line rounded-md border p-3">
                <p className="text-[13px] font-semibold">{test.title}</p>
                <p className="text-muted mt-0.5 text-xs">{test.blurb}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {/*
                    The two scannable tests need a REAL product, because the
                    test is "does the shop's scanner read this back as the
                    right item". The picker is here rather than being a note
                    telling staff to go and find it somewhere else: the first
                    draft said "start this one from Inventory", pointing at a
                    button that does not exist. That is the same shape as the
                    Add Job dialog offering a Mail-in option that 400'd.
                  */}
                  {test.needsProduct ? (
                    <select
                      className="border-line bg-card h-8 min-w-0 flex-1 rounded-md border px-2 text-xs"
                      value={productId}
                      onChange={(e) => setProductId(e.target.value)}
                      aria-label="Product to print a barcode for"
                    >
                      <option value="">Choose a product…</option>
                      {scannable.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={enqueue.isPending || (test.needsProduct && !productId)}
                    onClick={() =>
                      enqueue.mutate({
                        kind: 'test_print',
                        variant: test.variant,
                        ...(test.needsProduct ? { entityId: productId } : {}),
                        // Timestamped so each press is a NEW job. The dedupe
                        // key exists to stop a double-click printing twice,
                        // not to stop the same test being run again later.
                        dedupeKey: `test:${test.variant}:${Date.now()}`,
                      })
                    }
                  >
                    Print this test
                  </Button>
                </div>
                {test.needsProduct && scannable.length === 0 && !products.isPending ? (
                  <p className="text-muted mt-2 text-xs italic">
                    No product has a barcode saved yet, so there is nothing to scan back. Add a
                    barcode to a product in Inventory first.
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ---- Queue ------------------------------------------------------ */}
      <section className="border-line bg-card rounded-lg border">
        <header className="border-line flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">
              {showAll ? 'Everything recently printed' : 'Waiting for you'}
            </h2>
            <p className="text-muted mt-0.5 text-xs">
              {showAll
                ? 'The last 100 jobs, newest first.'
                : 'Anything the shop needs to answer or retry.'}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Only what needs me' : 'Show everything'}
          </Button>
        </header>

        {queue.isPending ? (
          <div className="grid gap-3 p-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : queue.isError ? (
          <div className="p-4">
            <EmptyState
              title="Could not read the print queue"
              description="The dashboard could not reach the server. Try Refresh."
            />
          </div>
        ) : (queue.data ?? []).length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={showAll ? 'Nothing has printed yet' : 'Nothing needs you'}
              description={
                showAll
                  ? 'Receipts and labels will appear here as they print.'
                  : 'Everything has printed. Anything that needs an answer will show up here.'
              }
            />
          </div>
        ) : (
          (queue.data ?? []).map((job) => <QueueRow key={job.id} job={job} />)
        )}
      </section>
    </div>
  );
}
