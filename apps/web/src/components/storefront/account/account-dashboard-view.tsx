'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MapPin, Package, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import {
  useSession,
  useMyOrders,
  useMyBookings,
  useAddressBook,
  useSaveAddressBookEntry,
  useSetDefaultAddressBookEntry,
  useDeleteAddressBookEntry,
} from '@/lib/data/hooks';
import type { AddressBookEntry, Booking, BookingStatus, Order } from '@/lib/data/types';
import { formatGBP, orderStatusLabel } from '@/lib/data/types';
import { formatDay } from '@/lib/dates';

/** Matches submissions-view.tsx's own local labels — kept in step by hand. */
function bookingStatusLabel(status: BookingStatus): string {
  switch (status) {
    case 'received':
      return 'Received';
    case 'in-progress':
      return 'In progress';
    case 'ready':
      return 'Ready';
    case 'dispatched':
      return 'Dispatched';
    case 'cancelled':
      return 'Cancelled';
  }
}

/**
 * The customer account dashboard (Round 5 Phase 3 #22). Shown right after
 * a customer signs in (DEFAULT_REDIRECT in lib/auth-redirect.ts now points
 * here instead of the homepage) and reachable any time from the account
 * menu.
 *
 * Two things live here: a unified order + repair history (GET /orders/mine
 * and GET /repair/bookings/mine — both new, self-scoped server-side, see
 * their route comments), and the address book built on top of Phase 1's
 * minimal `customer_addresses` storage (#30) rather than a second table —
 * setting a default here is the exact row checkout's "save my information"
 * checkbox already reads.
 *
 * Customer accounts stay optional (BUSINESS RULE, lib/data/types/auth.ts)
 * — nothing about the rest of the storefront changes because this page
 * exists. This page itself is the one place that genuinely needs a
 * customer session, so it's the one place that redirects to /login when
 * there isn't one, rather than rendering a locked-out placeholder.
 */
export function AccountDashboardView() {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();
  const isCustomer = session?.kind === 'customer';

  useEffect(() => {
    if (sessionPending) return;
    if (!session) {
      router.replace('/login?redirect=/account');
    } else if (session.kind !== 'customer') {
      // A staff member landed here somehow (typed the URL) — there is
      // nothing for them on this page.
      router.replace('/');
    }
  }, [session, sessionPending, router]);

  const { data: orders } = useMyOrders(isCustomer);
  const { data: bookings } = useMyBookings(isCustomer);

  if (sessionPending || !isCustomer) {
    return (
      <section className="account-page">
        <div className="container">
          <p className="text-muted text-sm">Loading your account…</p>
        </div>
      </section>
    );
  }

  type HistoryRow =
    { kind: 'order'; at: string; data: Order } | { kind: 'repair'; at: string; data: Booking };

  const history: HistoryRow[] = [
    ...(orders ?? []).map((o): HistoryRow => ({ kind: 'order', at: o.createdAt, data: o })),
    ...(bookings ?? []).map((b): HistoryRow => ({ kind: 'repair', at: b.createdAt, data: b })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="account-page">
      <div className="container">
        <p className="eyebrow">Your account</p>
        <h1 className="account-page__title">
          Hi {session.name.trim().split(/\s+/)[0] || 'there'}.
        </h1>
        <p className="text-muted -mt-1 max-w-lg text-sm">
          Every order and repair on your account, and the addresses you’ve saved for checkout.
        </p>

        <h2 className="co-block-title" style={{ marginTop: 40 }}>
          <Package className="acct-section-icon" aria-hidden="true" />
          Orders &amp; repairs
        </h2>
        {history.length === 0 ? (
          <p className="text-muted text-sm">
            Nothing yet — your orders and repair requests will show up here.
          </p>
        ) : (
          <div className="acct-history">
            {history.map((row) => (
              <HistoryCard key={`${row.kind}-${row.data.id}`} row={row} />
            ))}
          </div>
        )}

        <h2 className="co-block-title">
          <MapPin className="acct-section-icon" aria-hidden="true" />
          Addresses
        </h2>
        <AddressBook />
      </div>
    </section>
  );
}

function HistoryCard({
  row,
}: {
  row: { kind: 'order'; at: string; data: Order } | { kind: 'repair'; at: string; data: Booking };
}) {
  const isOrder = row.kind === 'order';
  const reference = row.data.reference;
  const statusLabel = isOrder
    ? orderStatusLabel((row.data as Order).status)
    : bookingStatusLabel((row.data as Booking).status);
  const amount = isOrder ? (row.data as Order).total : (row.data as Booking).price;
  // Round 5 Phase 3 #23: "already stored on orders since Round 4, just
  // never surfaced" — surfaced here, on the account's own order rows, not
  // just behind the Track link.
  const courier = isOrder ? (row.data as Order).courier : null;
  const trackingNumber = isOrder ? (row.data as Order).trackingNumber : null;

  return (
    <article className="acct-history__card">
      <div className="acct-history__meta">
        <span className="acct-history__kind">{isOrder ? 'Order' : 'Repair'}</span>
        <span className="acct-history__ref">{reference}</span>
        <span className="acct-history__date">{formatDay(row.at)}</span>
        {courier && trackingNumber ? (
          <span className="acct-history__courier">
            {courier} · {trackingNumber}
          </span>
        ) : null}
      </div>
      <div className="acct-history__right">
        <span className="acct-history__status">{statusLabel}</span>
        <span className="acct-history__amount">
          {amount != null ? formatGBP(amount) : 'Quote first'}
        </span>
        {/* Round 5 Phase 3 #22/#23: one click, no re-typing the reference —
            already known here. Orders only: #23 narrowed /track to Order
            IDs, so a repair's own status (shown just above, already the
            full picture the account has for it) is the only "tracking"
            a repair row gets here. */}
        {isOrder ? (
          <Link
            href={`/track?ref=${encodeURIComponent(reference)}`}
            className="acct-history__track"
          >
            Track →
          </Link>
        ) : null}
      </div>
    </article>
  );
}

/* ---- address book ------------------------------------------------------ */

function AddressBook() {
  const { data: addresses, isPending } = useAddressBook();
  const saveEntry = useSaveAddressBookEntry();
  const setDefault = useSetDefaultAddressBookEntry();
  const deleteEntry = useDeleteAddressBookEntry();

  const [editing, setEditing] = useState<AddressBookEntry | 'new' | null>(null);

  if (isPending) return <p className="text-muted text-sm">Loading your addresses…</p>;

  const list = addresses ?? [];

  return (
    <div className="acct-addresses">
      {list.length === 0 ? (
        <p className="text-muted text-sm">No saved addresses yet.</p>
      ) : (
        <div className="acct-address-grid">
          {list.map((a) => (
            <div key={a.id} className="acct-address-card">
              {a.isDefault ? (
                <span className="acct-address-card__default">
                  <Star className="size-3" fill="currentColor" aria-hidden="true" />
                  Default
                </span>
              ) : null}
              {a.label ? <p className="acct-address-card__label">{a.label}</p> : null}
              <p className="acct-address-card__line">{a.address}</p>
              <p className="acct-address-card__line">{a.postcode}</p>
              <div className="acct-address-card__actions">
                {!a.isDefault ? (
                  <button
                    type="button"
                    onClick={() => setDefault.mutate(a.id)}
                    disabled={setDefault.isPending}
                  >
                    Set as default
                  </button>
                ) : null}
                <button type="button" onClick={() => setEditing(a)}>
                  <Pencil className="size-3.5" aria-hidden="true" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Remove this address?')) deleteEntry.mutate(a.id);
                  }}
                  disabled={deleteEntry.isPending}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <AddressForm
          entry={editing === 'new' ? null : editing}
          pending={saveEntry.isPending}
          onCancel={() => setEditing(null)}
          onSubmit={(values) => {
            saveEntry.mutate(
              { ...values, id: editing === 'new' ? undefined : editing.id },
              { onSuccess: () => setEditing(null) },
            );
          }}
        />
      ) : (
        <button
          type="button"
          className="btn btn--ghost acct-add-address"
          onClick={() => setEditing('new')}
        >
          <Plus className="size-4" aria-hidden="true" />
          <span className="btn__label">Add address</span>
        </button>
      )}
    </div>
  );
}

function AddressForm({
  entry,
  pending,
  onCancel,
  onSubmit,
}: {
  entry: AddressBookEntry | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: {
    label?: string;
    address: string;
    postcode: string;
    isDefault?: boolean;
  }) => void;
}) {
  const [label, setLabel] = useState(entry?.label ?? '');
  const [address, setAddress] = useState(entry?.address ?? '');
  const [postcode, setPostcode] = useState(entry?.postcode ?? '');
  const [isDefault, setIsDefault] = useState(entry?.isDefault ?? false);

  return (
    <form
      className="acct-address-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!address.trim() || !postcode.trim()) return;
        onSubmit({
          label: label.trim() || undefined,
          address: address.trim(),
          postcode: postcode.trim(),
          isDefault: isDefault || undefined,
        });
      }}
    >
      <label className="field">
        <span>Label (optional)</span>
        <input
          type="text"
          placeholder="e.g. Home"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Address</span>
        <input
          type="text"
          placeholder="4 Cherry Lane, Yourtown"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Postcode</span>
        <input
          type="text"
          placeholder="YT1 2AB"
          value={postcode}
          onChange={(e) => setPostcode(e.target.value)}
        />
      </label>
      {!entry?.isDefault ? (
        <label className="acct-address-form__default">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Make this my default
        </label>
      ) : null}
      <div className="acct-address-form__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={pending}>
          <span className="btn__label">Cancel</span>
        </button>
        <button type="submit" className="btn btn--ink" disabled={pending}>
          <span className="btn__label">{pending ? 'Saving…' : 'Save address'}</span>
        </button>
      </div>
    </form>
  );
}
