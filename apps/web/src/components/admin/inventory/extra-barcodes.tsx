'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useExtraBarcodes } from '@/lib/data/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Barcodes beyond the main one (client changes, Oct 2026 #8; 0122): the same item arriving with a
 * different barcode — another supplier, a new pack. Each one scans to this product (or this
 * variation) at the till. Typed, or scanned straight into the box: a scanner ends with Enter, which
 * adds it here rather than submitting the form around it. Saved at once, not with the form.
 */
export function ExtraBarcodes({
  productId,
  variantId,
  barcodes,
}: {
  productId: string;
  /** Set when these belong to one variation. */
  variantId?: string;
  barcodes: { id: string; barcode: string }[];
}) {
  const { add, remove } = useExtraBarcodes(productId);
  // The dialog around this holds a snapshot of the product, so the list keeps itself current.
  const [list, setList] = useState(barcodes);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const barcode = value.trim();
    if (!barcode) return;
    setError(null);
    add.mutate(
      { barcode, variantId },
      {
        onSuccess: (added) => {
          setList((current) => [...current, added]);
          setValue('');
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Could not add it.'),
      },
    );
  };

  return (
    <div className="grid gap-2">
      <p className="text-ink text-sm font-semibold">Other barcodes</p>
      {list.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {list.map((b) => (
            <li
              key={b.id}
              className="bg-paper-2 text-ink tabular inline-flex items-center gap-1 rounded-md py-1 pl-2.5 pr-1 text-xs font-semibold"
            >
              {b.barcode}
              <button
                type="button"
                onClick={() =>
                  remove.mutate(b.id, {
                    onSuccess: () => setList((current) => current.filter((x) => x.id !== b.id)),
                  })
                }
                disabled={remove.isPending}
                aria-label={`Remove barcode ${b.barcode}`}
                className="text-muted hover:text-red rounded p-0.5"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Scan or type another barcode"
          aria-label="Another barcode"
          autoComplete="off"
          className="tabular"
        />
        <Button
          type="button"
          variant="outline"
          onClick={submit}
          disabled={add.isPending || !value.trim()}
        >
          <Plus aria-hidden="true" />
          {add.isPending ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {error ? (
        <p className="text-red text-xs font-semibold" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-muted text-xs">Each one scans to this item at the till.</p>
      )}
    </div>
  );
}
