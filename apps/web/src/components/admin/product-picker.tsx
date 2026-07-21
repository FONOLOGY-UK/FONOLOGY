'use client';

import { useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { useAdminProducts, useCategories } from '@/lib/data/hooks';
import { formatGBP } from '@/lib/data/types';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Multi-select product picker. Used by Promotions so one promotion can cover a
 * whole range without the counter creating a promotion per SKU.
 *
 * Deliberately not a combobox: staff scan a list of ~16 products faster than
 * they type, and the category shortcuts ("all Screen protection") are the
 * action they actually want.
 */
export function ProductPicker({
  value,
  onChange,
  error,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  error?: string;
}) {
  const { data: products, isPending } = useAdminProducts();
  const { data: categories } = useCategories();
  const [query, setQuery] = useState('');

  const selected = useMemo(() => new Set(value), [value]);

  /* `all` is the storefront's "Everything" filter chip, not a real category —
     a shortcut for it would just be "select all" wearing a category's name. */
  const realCategories = useMemo(
    () => (categories ?? []).filter((c) => c.id !== 'all'),
    [categories],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!products) return [];
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.barcode ?? '').includes(q),
    );
  }, [products, query]);

  const toggle = (id: string) => {
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  /** Category shortcut: add every product in it, or clear them all if already in. */
  const toggleCategory = (categoryId: string) => {
    const ids = (products ?? []).filter((p) => p.category === categoryId).map((p) => p.id);
    const allIn = ids.length > 0 && ids.every((id) => selected.has(id));
    onChange(allIn ? value.filter((v) => !ids.includes(v)) : [...new Set([...value, ...ids])]);
  };

  const nameFor = (id: string) => products?.find((p) => p.id === id)?.name ?? id;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <p className="text-ink text-[11px] font-semibold uppercase tracking-[0.08em]">Products</p>
        <p className="text-muted text-xs">
          {value.length === 0 ? 'None selected' : `${value.length} selected`}
          {value.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="hover:text-red-deep ml-2 underline underline-offset-2"
            >
              Clear
            </button>
          ) : null}
        </p>
      </div>

      {/* selected chips — the fast way to see and undo a big multi-select */}
      {value.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => toggle(id)}
                className="bg-ink text-bone hover:bg-red-deep inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold transition-colors duration-150"
              >
                {nameFor(id)}
                <X className="size-3" aria-hidden="true" />
                <span className="sr-only">Remove</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="border-input rounded-ui overflow-hidden border">
        <div className="border-line bg-paper-2/40 flex items-center gap-2 border-b px-2.5 py-1.5">
          <Search className="text-muted size-3.5 shrink-0" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter products…"
            aria-label="Filter products"
            className="placeholder:text-muted/70 w-full bg-transparent py-1 text-sm outline-none"
          />
        </div>

        {/* category shortcuts */}
        {realCategories.length > 0 && query.trim() === '' ? (
          <div className="border-line flex flex-wrap gap-1 border-b px-2.5 py-2">
            {realCategories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleCategory(c.id)}
                className="bg-paper-2 text-muted hover:text-ink rounded px-2 py-1 text-[11px] font-semibold transition-colors duration-150"
              >
                All {c.label.toLowerCase()}
              </button>
            ))}
          </div>
        ) : null}

        <div className="max-h-[220px] overflow-y-auto">
          {isPending ? (
            <div className="grid gap-1.5 p-2.5">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : visible.length === 0 ? (
            <p className="text-muted p-4 text-center text-sm">No products match “{query}”.</p>
          ) : (
            <ul>
              {visible.map((p) => {
                const on = selected.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => toggle(p.id)}
                      aria-pressed={on}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-sm transition-colors duration-150',
                        on ? 'bg-red-tint/60' : 'hover:bg-paper-2/60',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'grid size-4 shrink-0 place-items-center rounded border',
                          on ? 'border-red bg-red text-white' : 'border-line-strong',
                        )}
                      >
                        {on ? <Check className="size-3" strokeWidth={3} /> : null}
                      </span>
                      <span className="text-ink min-w-0 flex-1 truncate font-medium">{p.name}</span>
                      <span className="tabular text-muted shrink-0 text-xs">
                        {formatGBP(p.price)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-red-deep mt-1.5 text-xs font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}
