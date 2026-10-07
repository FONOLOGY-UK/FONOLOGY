'use client';

import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  useAddDeliveryPrefix,
  useAdminDelivery,
  useRemoveDeliveryPrefix,
  useSaveDeliveryRate,
  useSession,
  useUpdateFreeDeliveryThreshold,
} from '@/lib/data/hooks';
import type { DeliveryRate, DeliveryZone } from '@/lib/data/types';
import { formatGBP, pounds } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Field } from '@/components/admin/field';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';

/**
 * Delivery (0102) — what each zone pays, which speeds it gets, which postcodes are remote and
 * the free-delivery threshold. All rows read by delivery_quote(), so a change here reaches the
 * checkout and the charge together. Site-wide: every shop sells through one website, so only
 * the owner can change it (managers can look).
 */
export function DeliveryView() {
  const { data, isPending, isError, refetch } = useAdminDelivery();
  const { data: session } = useSession();
  const isOwner = session?.kind === 'staff' && session.staffRole === 'owner';

  return (
    <div>
      <PageHeader
        eyebrow="Team"
        title="Delivery"
        description="Online delivery prices by zone, which postcodes count as remote, and when delivery is free. Changes apply to the checkout straight away."
      />

      {isError ? (
        <div className="border-line bg-card rounded-lg border p-8 text-center">
          <p className="text-ink mb-3 text-sm font-semibold">Delivery settings didn’t load.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-[120px]" />
          <Skeleton className="h-[160px]" />
          <Skeleton className="h-[220px]" />
        </div>
      ) : (
        <div className="grid gap-6">
          {!isOwner ? (
            <p className="text-muted text-sm">
              Only the owner can change delivery settings — they apply to every shop.
            </p>
          ) : null}
          <ThresholdCard threshold={data.freeDeliveryThreshold} editable={isOwner} />
          {data.zones.map((zone) => (
            <ZoneCard key={zone.id} zone={zone} editable={isOwner} />
          ))}
          <PostcodesCard zones={data.zones} prefixes={data.prefixes} editable={isOwner} />
        </div>
      )}
    </div>
  );
}

/* ---- free-delivery threshold --------------------------------------------- */

function ThresholdCard({ threshold, editable }: { threshold: number | null; editable: boolean }) {
  const save = useUpdateFreeDeliveryThreshold();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  useEffect(() => {
    setValue(threshold === null ? '' : (threshold / 100).toFixed(2));
  }, [threshold]);

  const submit = () => {
    const amount = Number(value);
    if (!value.trim() || !Number.isFinite(amount) || amount < 0) {
      setError('Enter an amount in pounds, e.g. 50.00');
      return;
    }
    setError(undefined);
    save.mutate(pounds(amount));
  };

  return (
    <section className="border-line bg-card rounded-lg border p-4">
      <h2 className="text-ink text-sm font-bold">Free delivery</h2>
      <p className="text-muted mb-3 mt-0.5 text-xs">
        Standard delivery to a mainland postcode is free when the items come to MORE than this
        amount — at exactly this amount it is still charged. Next-day and remote delivery are always
        charged.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Free over (£)" htmlFor="fd-threshold" error={error} className="w-40">
          <Input
            id="fd-threshold"
            inputMode="decimal"
            value={value}
            disabled={!editable}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        {editable ? (
          <Button onClick={submit} disabled={save.isPending}>
            Save
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/* ---- one zone's rates ----------------------------------------------------- */

const METHOD_LABEL: Record<DeliveryRate['method'], string> = {
  standard: 'Standard',
  'next-day': 'Next day',
};

function ZoneCard({ zone, editable }: { zone: DeliveryZone; editable: boolean }) {
  return (
    <section className="border-line bg-card rounded-lg border p-4">
      <h2 className="text-ink text-sm font-bold">{zone.label}</h2>
      <p className="text-muted mb-3 mt-0.5 text-xs">
        {zone.code === 'standard'
          ? 'Every postcode not on the remote list below.'
          : 'Postcodes on the remote list below.'}
      </p>
      <div className="grid gap-2">
        {zone.rates.map((rate) => (
          <RateRow key={rate.id} rate={rate} editable={editable} />
        ))}
      </div>
    </section>
  );
}

function RateRow({ rate, editable }: { rate: DeliveryRate; editable: boolean }) {
  const save = useSaveDeliveryRate();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  useEffect(() => {
    setValue((rate.price / 100).toFixed(2));
  }, [rate.price]);

  const submit = (available: boolean) => {
    const amount = Number(value);
    if (!value.trim() || !Number.isFinite(amount) || amount < 0) {
      setError('Enter a price in pounds');
      return;
    }
    setError(undefined);
    save.mutate({ id: rate.id, price: pounds(amount), available });
  };

  return (
    <div className="border-line flex flex-wrap items-end justify-between gap-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <span className="text-ink text-sm font-semibold">{METHOD_LABEL[rate.method]}</span>
        {rate.available ? (
          <StatusChip tone="success">Offered</StatusChip>
        ) : (
          <StatusChip tone="neutral">Not offered</StatusChip>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Price (£)" htmlFor={`rate-${rate.id}`} error={error} className="w-32">
          <Input
            id={`rate-${rate.id}`}
            inputMode="decimal"
            value={value}
            disabled={!editable || !rate.available}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        {editable ? (
          <>
            {rate.available ? (
              <Button size="sm" onClick={() => submit(true)} disabled={save.isPending}>
                Save
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => submit(!rate.available)}
              disabled={save.isPending}
            >
              {rate.available ? 'Stop offering' : 'Offer it'}
            </Button>
          </>
        ) : (
          <span className="text-muted tabular pb-2 text-xs">{formatGBP(rate.price)}</span>
        )}
      </div>
    </div>
  );
}

/* ---- remote postcode list ------------------------------------------------- */

function PostcodesCard({
  zones,
  prefixes,
  editable,
}: {
  zones: DeliveryZone[];
  prefixes: { prefix: string; zoneId: string }[];
  editable: boolean;
}) {
  const add = useAddDeliveryPrefix();
  const remove = useRemoveDeliveryPrefix();
  const [value, setValue] = useState('');
  const [filter, setFilter] = useState('');
  const remote = zones.find((z) => z.code === 'remote');
  const listed = prefixes.filter((p) =>
    filter.trim() ? p.prefix.startsWith(filter.trim().toUpperCase().replace(/\s+/g, '')) : true,
  );

  const submit = () => {
    if (!remote || !value.trim()) return;
    add.mutate({ prefix: value.trim(), zoneId: remote.id }, { onSuccess: () => setValue('') });
  };

  return (
    <section className="border-line bg-card rounded-lg border p-4">
      <h2 className="text-ink text-sm font-bold">Remote postcodes ({prefixes.length})</h2>
      <p className="text-muted mb-3 mt-0.5 text-xs">
        A whole area (“BT”) or a single district (“PH3”). “PH3” covers PH3 only, not PH30. Every
        postcode not listed is mainland. BFPO addresses are always refused.
      </p>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        {editable ? (
          <>
            <Field label="Add area or district" htmlFor="pc-add" className="w-44">
              <Input
                id="pc-add"
                value={value}
                placeholder="e.g. PH3"
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
              />
            </Field>
            <Button onClick={submit} disabled={add.isPending || !value.trim()}>
              <Plus aria-hidden="true" />
              Add
            </Button>
          </>
        ) : null}
        <Field label="Find" htmlFor="pc-find" className="ml-auto w-36">
          <Input id="pc-find" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </Field>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {listed.map((p) => (
          <li
            key={p.prefix}
            className="border-line bg-paper-2/40 text-ink tabular inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold"
          >
            {p.prefix}
            {editable ? (
              <button
                type="button"
                className="text-muted hover:text-red-deep"
                aria-label={`Remove ${p.prefix}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(p.prefix)}
              >
                <X className="size-3" />
              </button>
            ) : null}
          </li>
        ))}
        {listed.length === 0 ? (
          <li className="text-muted text-xs">No matching postcodes.</li>
        ) : null}
      </ul>
    </section>
  );
}
