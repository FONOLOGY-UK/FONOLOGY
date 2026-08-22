'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Copy, Link2, PackagePlus, X } from 'lucide-react';
import {
  useAdminCategories,
  useCreatePayoutForRequest,
  useCreateSellAcceptToken,
  useQuoteSellRequest,
  useRestockPayout,
  useSellRequest,
  useSetSellRequestStatus,
  useStaff,
  useTradeInPayoutPage,
} from '@/lib/data/hooks';
import type { PayoutMethod, SellRequest, SellStatus, TradeInPayout } from '@/lib/data/types';
import { formatGBP, payoutMethodLabel, pounds, sellStatusLabel } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Field } from '@/components/admin/field';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';

/**
 * One trade-in request, and everything staff do to it.
 *
 * The flow is submitted → quoted → accepted | declined → received → paid |
 * rejected, and every move here is a person's decision. Nothing on this screen
 * computes a price: the quote box starts empty even when the customer's own
 * intake data would let us guess, because a guessed figure shown to staff
 * becomes the figure they type.
 */
export function TradeInDetailView({ id }: { id: string }) {
  const { data: request, isPending, isError, refetch } = useSellRequest(id);

  if (isPending) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-56" />
      </div>
    );
  }

  if (isError || !request) {
    return (
      <div className="border-line bg-card rounded-lg border p-8 text-center">
        <p className="text-ink mb-3 text-sm font-semibold">That request didn’t load.</p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/trade-ins">Back to the queue</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/admin/trade-ins">
          <ArrowLeft aria-hidden="true" />
          Queue
        </Link>
      </Button>

      <PageHeader
        eyebrow={`Trade-in · ${request.reference}`}
        title={request.deviceOther ?? request.deviceName ?? 'Device'}
        description={`${request.name} · ${request.email} · ${request.phone}`}
        actions={<StatusChip tone="ink">{sellStatusLabel(request.status)}</StatusChip>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ConditionPanel request={request} />
        <QuotePanel request={request} />
        <StatusPanel request={request} />
        <PayoutPanel request={request} />
      </div>
    </div>
  );
}

/* ---- what the customer told us --------------------------------------------- */

function ConditionPanel({ request }: { request: SellRequest }) {
  const c = request.condition;
  return (
    <section className="border-line bg-card rounded-lg border p-4">
      <h2 className="text-ink mb-3 text-[11px] font-semibold uppercase tracking-[0.08em]">
        What the customer told us
      </h2>
      {c ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Row label="Storage" value={c.storage} />
          <Row label="Screen" value={c.screen} />
          <Row label="Body" value={c.body} />
          <Row label="Powers on" value={c.powersOn ? 'Yes' : 'No'} />
          <Row label="Network" value={c.network} />
          <Row
            label="Accessories"
            value={c.accessories.length ? c.accessories.join(', ') : 'None'}
          />
        </dl>
      ) : (
        <p className="text-muted text-sm">No condition detail recorded.</p>
      )}
      {request.notes ? (
        <p className="text-muted mt-3 border-t border-[var(--line)] pt-3 text-sm">
          <span className="text-ink font-medium">Their note: </span>
          {request.notes}
        </p>
      ) : null}
      <p className="text-muted mt-3 text-xs">
        Self-reported. Inspect the device before quoting — this is a starting point, not a grade.
      </p>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="text-ink font-medium capitalize">{value}</dd>
    </div>
  );
}

/* ---- the quote -------------------------------------------------------------- */

function QuotePanel({ request }: { request: SellRequest }) {
  const quote = useQuoteSellRequest();
  const acceptToken = useCreateSellAcceptToken();
  const { data: staff } = useStaff();
  const [pounds_, setPounds] = useState('');
  const [link, setLink] = useState<{ url: string; expiresAt: string; emailSent: boolean } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const quotedByName =
    request.quotedBy && staff ? (staff.find((s) => s.id === request.quotedBy)?.name ?? null) : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = pounds(Number(pounds_) || 0);
    if (amount <= 0) return;
    quote.mutate({ id: request.id, amount }, { onSuccess: () => setPounds('') });
  };

  return (
    <section className="border-line bg-card rounded-lg border p-4">
      <h2 className="text-ink mb-3 text-[11px] font-semibold uppercase tracking-[0.08em]">
        Our offer
      </h2>

      {request.quotedAmount != null ? (
        <div className="bg-paper-2/60 mb-3 rounded-md px-3 py-2.5">
          <p className="text-ink tabular text-2xl font-bold">
            {formatGBP(request.quotedAmount, { alwaysShowPennies: true })}
          </p>
          <p className="text-muted mt-0.5 text-xs">
            {/* Both stamped by the server from the session — the browser never
                says who quoted, so this line can't be wrong. */}
            Quoted by {quotedByName ?? 'staff'}
            {request.quotedAt ? ` · ${formatDateTime(request.quotedAt)}` : ''}
          </p>
        </div>
      ) : (
        <p className="text-muted mb-3 text-sm">
          Not quoted yet. Enter what the shop will pay after looking at the device.
        </p>
      )}

      <form onSubmit={submit} className="flex items-end gap-2">
        <Field
          label={request.quotedAmount != null ? 'Re-quote (£)' : 'Quote (£)'}
          htmlFor="quote-amount"
        >
          <Input
            id="quote-amount"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            className="tabular w-32"
            placeholder="0.00"
            value={pounds_}
            onChange={(e) => setPounds(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={quote.isPending || !pounds_}>
          {quote.isPending ? 'Saving…' : 'Save quote'}
        </Button>
      </form>

      {/* The customer may have no account, so acceptance travels by link. */}
      {request.quotedAmount != null ? (
        <div className="mt-4 border-t border-[var(--line)] pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={acceptToken.isPending}
            onClick={() =>
              acceptToken.mutate(request.id, {
                onSuccess: (t) => {
                  setLink({
                    url: `${window.location.origin}/sell/accept?token=${encodeURIComponent(t.token)}`,
                    expiresAt: t.expiresAt,
                    emailSent: t.emailSent,
                  });
                  setCopied(false);
                },
              })
            }
          >
            <Link2 aria-hidden="true" />
            {acceptToken.isPending ? 'Creating…' : 'Create acceptance link'}
          </Button>

          {link ? (
            <div className="border-line bg-blush mt-3 rounded-md border p-3">
              <p className="text-ink-2 text-xs">
                {link.emailSent ? (
                  <strong>Emailed to the customer.</strong>
                ) : (
                  <strong>Could not email this — send it yourself.</strong>
                )}{' '}
                It works once, expires {formatDateTime(link.expiresAt)}, and cannot be shown again —
                only its hash is stored, so there is no way to look it up later.
              </p>
              <div className="mt-2 flex gap-2">
                <Input readOnly value={link.url} className="text-xs" aria-label="Acceptance link" />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(link.url);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/* ---- staff-driven status moves --------------------------------------------- */

/**
 * Only the moves that make sense from where the request currently is. The
 * schema's own transition guard is the real authority — this just avoids
 * offering buttons that would be refused.
 */
const NEXT_STATUSES: Record<SellStatus, SellStatus[]> = {
  submitted: ['declined'],
  quoted: ['accepted', 'declined'],
  accepted: ['received'],
  received: ['paid', 'rejected'],
  declined: [],
  paid: [],
  rejected: [],
};

function StatusPanel({ request }: { request: SellRequest }) {
  const setStatus = useSetSellRequestStatus();
  const options = NEXT_STATUSES[request.status];

  return (
    <section className="border-line bg-card rounded-lg border p-4">
      <h2 className="text-ink mb-3 text-[11px] font-semibold uppercase tracking-[0.08em]">
        Move it along
      </h2>
      <p className="text-muted mb-3 text-sm">
        Currently <strong className="text-ink">{sellStatusLabel(request.status)}</strong>.
      </p>
      {options.length === 0 ? (
        <p className="text-muted text-sm">
          This request is finished — nothing follows {sellStatusLabel(request.status).toLowerCase()}
          .
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((next) => (
            <Button
              key={next}
              variant={next === 'declined' || next === 'rejected' ? 'outline' : 'default'}
              size="sm"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: request.id, status: next })}
            >
              {next === 'declined' || next === 'rejected' ? <X aria-hidden="true" /> : null}
              {sellStatusLabel(next)}
            </Button>
          ))}
        </div>
      )}
      <p className="text-muted mt-3 text-xs">
        “Customer declined” is them saying no to the offer. “Rejected on inspection” is us saying no
        after seeing the device.
      </p>
    </section>
  );
}

/* ---- payout + restock ------------------------------------------------------- */

function PayoutPanel({ request }: { request: SellRequest }) {
  const createPayout = useCreatePayoutForRequest();
  // Payouts for this request specifically. Filtered by id, NOT by the
  // request's reference: a payout row carries its own BUY- reference and knows
  // nothing about the FNL- one, so searching by reference always found nothing.
  const { data: payoutPage } = useTradeInPayoutPage({ sellRequestId: request.id, limit: 20 });
  const existing = payoutPage?.items ?? [];

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayoutMethod>('cash');
  const [notes, setNotes] = useState('');

  const canPay = request.status === 'received' || request.status === 'accepted';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const paid = pounds(Number(amount) || 0);
    if (paid <= 0) return;
    createPayout.mutate(
      {
        id: request.id,
        input: {
          deviceLabel: request.deviceOther ?? request.deviceName ?? 'Device',
          customerName: request.name,
          // Positive here — "what we paid". The server is the single place it
          // becomes negative, and it stamps the staff member from the session.
          amount: paid,
          method,
          notes: notes.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          setAmount('');
          setNotes('');
        },
      },
    );
  };

  return (
    <section className="border-line bg-card rounded-lg border p-4">
      <h2 className="text-ink mb-3 text-[11px] font-semibold uppercase tracking-[0.08em]">
        Payout
      </h2>

      {existing.length > 0 ? (
        <div className="mb-3 grid gap-2">
          {existing.map((p) => (
            <PayoutRow key={p.id} payout={p} />
          ))}
        </div>
      ) : null}

      {canPay ? (
        <form onSubmit={submit} className="grid gap-3">
          <div className="flex items-end gap-2">
            <Field label="Paid (£)" htmlFor="payout-amount">
              <Input
                id="payout-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="tabular w-28"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Method" htmlFor="payout-method">
              <Select
                id="payout-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as PayoutMethod)}
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
              </Select>
            </Field>
          </div>
          <Field label="Note (optional)" htmlFor="payout-notes">
            <Input
              id="payout-notes"
              placeholder="e.g. Battery health 91%"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted text-xs">
              Recorded as money out, against you, from your session.
            </p>
            <Button type="submit" disabled={createPayout.isPending || !amount}>
              {createPayout.isPending ? 'Recording…' : 'Record payout'}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-muted text-sm">
          {existing.length > 0
            ? 'Paid. Restock below if the device is going on the shelf.'
            : `Nothing to pay yet — the request is ${sellStatusLabel(request.status).toLowerCase()}.`}
        </p>
      )}
    </section>
  );
}

function PayoutRow({ payout }: { payout: TradeInPayout }) {
  return (
    <div className="bg-paper-2/60 rounded-md px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-ink text-sm font-semibold">{payout.reference}</p>
          <p className="text-muted text-xs">
            {payoutMethodLabel(payout.method)} · {payout.staffName ?? '—'} ·{' '}
            {formatDateTime(payout.createdAt)}
          </p>
        </div>
        {/* Stored negative; shown with the sign so it never reads as income. */}
        <p className="text-red-deep tabular font-bold">
          {formatGBP(payout.amount, { alwaysShowPennies: true })}
        </p>
      </div>
      <RestockControl payout={payout} />
    </div>
  );
}

/**
 * Restock is manual, always. A bought device becomes stock only because
 * someone ticked this box and set a price — never as a side effect of paying
 * for it. The cost recorded against the new product is the payout amount, so
 * the margin on the eventual sale is what the shop actually made.
 */
function RestockControl({ payout }: { payout: TradeInPayout }) {
  const restock = useRestockPayout();
  const { data: categories } = useAdminCategories();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(payout.deviceLabel);
  // No fixed default — categories are admin-editable now (FEATURE-05), not a
  // 7-value list to pick a first entry from. Seeded to the first category
  // once the live list loads (see the effect below); empty until then, which
  // "Add to stock" already refuses via the resale-price check below — a
  // submit before categories have loaded would post an empty categoryId,
  // which the API correctly rejects.
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState('');

  // Seed the picker once real categories are in — an empty select would
  // otherwise silently submit no category at all.
  useEffect(() => {
    if (!categoryId && categories && categories.length > 0) {
      setCategoryId(categories[0]!.id);
    }
  }, [categories, categoryId]);

  if (payout.restocked) {
    return (
      <p className="text-muted mt-2 flex items-center gap-1.5 border-t border-[var(--line)] pt-2 text-xs">
        <Check className="size-3.5 shrink-0" aria-hidden="true" />
        On the shelf
        {payout.resalePrice != null ? ` at ${formatGBP(payout.resalePrice)}` : ''} · cost recorded
        as {formatGBP(Math.abs(payout.amount))}
      </p>
    );
  }

  return (
    <div className="mt-2 border-t border-[var(--line)] pt-2">
      <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
        <input
          type="checkbox"
          className="accent-[var(--red)]"
          checked={open}
          onChange={(e) => setOpen(e.target.checked)}
        />
        Add this device to stock for resale
      </label>

      {open ? (
        <form
          className="mt-2 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const resale = pounds(Number(price) || 0);
            if (resale <= 0 || !categoryId) return;
            restock.mutate({
              id: payout.id,
              input: {
                name: name.trim(),
                categoryId,
                resalePrice: resale,
              },
            });
          }}
        >
          <Field label="Shelf name" htmlFor={`restock-name-${payout.id}`}>
            <Input
              id={`restock-name-${payout.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Field label="Category" htmlFor={`restock-cat-${payout.id}`}>
              <Select
                id={`restock-cat-${payout.id}`}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Resale price (£)" htmlFor={`restock-price-${payout.id}`}>
              <Input
                id={`restock-price-${payout.id}`}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="tabular w-28"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </Field>
          </div>
          <p className="text-muted text-xs">
            Cost will be recorded as {formatGBP(Math.abs(payout.amount))} — what we actually paid.
          </p>
          <Button type="submit" size="sm" disabled={restock.isPending || !price || !categoryId}>
            <PackagePlus aria-hidden="true" />
            {restock.isPending ? 'Adding…' : 'Add to stock'}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
