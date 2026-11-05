'use client';

import { useMemo, useState } from 'react';
import { Link2, Plus, Search, X } from 'lucide-react';
import { usePromotionGroups, useSavePromotionGroup } from '@/lib/data/hooks';
import type { PromotionGroup } from '@/lib/data/types';
import { formatGBP, pounds } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/admin/field';

export interface PromoTierDraft {
  key: string;
  minQty: string;
  totalPounds: string;
}

export function newTierDraft(minQty = '2'): PromoTierDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    minQty,
    totalPounds: '',
  };
}

export interface ProductOfferDraft {
  label: string;
  mixMatch: boolean;
  tiers: PromoTierDraft[];
}

/** The tiers as the API takes them, or what is wrong with them. Blank lines are ignored. */
export function readTiers(
  tiers: PromoTierDraft[],
):
  | { tiers: { minQty: number; totalPrice: number }[]; error: null }
  | { tiers: null; error: string } {
  const filled = tiers.filter((t) => t.totalPounds.trim());
  if (filled.length === 0) return { tiers: null, error: 'Enter the total price for the deal.' };
  const seen = new Set<number>();
  const out: { minQty: number; totalPrice: number }[] = [];
  for (const t of filled) {
    const minQty = Number(t.minQty);
    if (!Number.isInteger(minQty) || minQty < 2) {
      return { tiers: null, error: 'A deal starts at 2 or more.' };
    }
    if (seen.has(minQty)) return { tiers: null, error: `There are two deals for ${minQty}.` };
    seen.add(minQty);
    const total = Number(t.totalPounds);
    if (!Number.isFinite(total) || total < 0) {
      return { tiers: null, error: 'A deal price can’t be negative.' };
    }
    out.push({ minQty, totalPrice: pounds(total) });
  }
  return { tiers: out, error: null };
}

/** Saving an offer sends the whole offer, so this keeps everything but the product list. */
export function relinkInput(group: PromotionGroup, productIds: string[]) {
  return {
    groupId: group.groupId,
    label: group.name,
    productIds,
    categoryIds: group.categoryIds,
    mixMatch: group.mixMatch,
    ...(group.shopIds?.length ? { shopIds: group.shopIds } : {}),
    tiers: group.tiers.map((t) => ({ minQty: t.minQty, totalPrice: t.totalPrice })),
    active: group.active,
  };
}

function dealSummary(group: PromotionGroup): string {
  return group.tiers.map((t) => `${t.minQty} for ${formatGBP(t.totalPrice)}`).join(', ');
}

/**
 * Promotions on the product form (client changes v2, 2.3 and 2.5): new deals as a list of tiers, and a
 * small button that links an offer already set up in the Promotions tab. Same offers, same endpoint:
 * whatever happens here shows in that tab.
 */
export function ProductPromotions({
  productId,
  draft,
  onDraftChange,
  linked,
  onLinkedChange,
}: {
  /** null on a product not saved yet: links wait for the save. */
  productId: string | null;
  draft: ProductOfferDraft | null;
  onDraftChange: (draft: ProductOfferDraft | null) => void;
  linked: string[];
  onLinkedChange: (groupIds: string[]) => void;
}) {
  const { data: groups } = usePromotionGroups();
  const save = useSavePromotionGroup();
  const [picking, setPicking] = useState(false);

  const current = useMemo(
    () =>
      (groups ?? []).filter((g) =>
        productId ? g.productIds.includes(productId) : linked.includes(g.groupId),
      ),
    [groups, productId, linked],
  );

  const link = (group: PromotionGroup) => {
    setPicking(false);
    if (!productId) {
      onLinkedChange([...linked, group.groupId]);
      return;
    }
    save.mutate(relinkInput(group, [...group.productIds, productId]));
  };
  const unlink = (group: PromotionGroup) => {
    if (!productId) {
      onLinkedChange(linked.filter((id) => id !== group.groupId));
      return;
    }
    const rest = group.productIds.filter((id) => id !== productId);
    if (rest.length === 0 && group.categoryIds.length === 0) return;
    save.mutate(relinkInput(group, rest));
  };

  const patchTier = (key: string, change: Partial<PromoTierDraft>) => {
    if (!draft) return;
    onDraftChange({
      ...draft,
      tiers: draft.tiers.map((t) => (t.key === key ? { ...t, ...change } : t)),
    });
  };

  return (
    <div className="border-line rounded-ui mb-4 grid gap-3 border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-ink text-sm font-bold">Promotions</p>
          <p className="text-muted text-xs">Till only. They show in the Promotions tab as well.</p>
        </div>
        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={() => setPicking(true)}>
            <Link2 aria-hidden="true" />
            Link existing
          </Button>
          {draft ? null : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onDraftChange({ label: '', mixMatch: false, tiers: [newTierDraft()] })}
            >
              <Plus aria-hidden="true" />
              New deal
            </Button>
          )}
        </div>
      </div>

      {current.length > 0 ? (
        <ul className="grid gap-1.5">
          {current.map((g) => {
            const onlyProduct =
              productId !== null && g.productIds.length === 1 && g.categoryIds.length === 0;
            return (
              <li
                key={g.groupId}
                className="bg-paper-2/60 flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[13px]"
              >
                <span className="min-w-0">
                  <span className="text-ink font-semibold">{g.name}</span>{' '}
                  <span className="text-muted tabular">· {dealSummary(g)}</span>
                </span>
                {onlyProduct ? (
                  <span className="text-muted shrink-0 text-[11px]">Edit in Promotions</span>
                ) : (
                  <button
                    type="button"
                    className="text-muted hover:text-red-deep shrink-0 p-0.5"
                    aria-label={`Unlink ${g.name}`}
                    disabled={save.isPending}
                    onClick={() => unlink(g)}
                  >
                    <X className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {draft ? (
        <div className="border-line grid gap-3 border-t pt-3">
          <Field label="Deal name" htmlFor="promo-label">
            <Input
              id="promo-label"
              placeholder="e.g. Multi-buy"
              value={draft.label}
              onChange={(e) => onDraftChange({ ...draft, label: e.target.value })}
            />
          </Field>
          <div className="grid gap-2">
            {draft.tiers.map((t) => {
              const qty = Number(t.minQty);
              const total = Number(t.totalPounds);
              const each =
                t.totalPounds.trim() && qty >= 2 && Number.isFinite(total)
                  ? formatGBP(Math.round(pounds(total) / qty))
                  : null;
              return (
                <div key={t.key} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted text-xs font-semibold">Buy</span>
                  <Input
                    type="number"
                    min="2"
                    step="1"
                    className="tabular h-9 w-16"
                    aria-label="Quantity"
                    value={t.minQty}
                    onChange={(e) => patchTier(t.key, { minQty: e.target.value })}
                  />
                  <span className="text-muted text-xs font-semibold">for £</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className="tabular h-9 w-24"
                    aria-label="Total promotion price"
                    placeholder="Total"
                    value={t.totalPounds}
                    onChange={(e) => patchTier(t.key, { totalPounds: e.target.value })}
                  />
                  {each ? <span className="text-muted tabular text-xs">{each} each</span> : null}
                  {draft.tiers.length > 1 ? (
                    <button
                      type="button"
                      className="text-muted hover:text-red-deep ml-auto p-1"
                      aria-label="Remove this tier"
                      onClick={() =>
                        onDraftChange({
                          ...draft,
                          tiers: draft.tiers.filter((x) => x.key !== t.key),
                        })
                      }
                    >
                      <X className="size-4" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onDraftChange({ ...draft, tiers: [...draft.tiers, newTierDraft('')] })}
            >
              <Plus aria-hidden="true" />
              Add tier
            </Button>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                className="accent-[var(--red)]"
                checked={draft.mixMatch}
                onChange={(e) => onDraftChange({ ...draft, mixMatch: e.target.checked })}
              />
              Mix &amp; Match its variations
            </label>
            <button
              type="button"
              className="text-muted hover:text-ink text-xs underline underline-offset-2"
              onClick={() => onDraftChange(null)}
            >
              Remove this deal
            </button>
          </div>
        </div>
      ) : null}

      {picking ? (
        <PromotionPicker
          groups={(groups ?? []).filter((g) => !current.some((c) => c.groupId === g.groupId))}
          onPick={link}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </div>
  );
}

function PromotionPicker({
  groups,
  onPick,
  onClose,
}: {
  groups: PromotionGroup[];
  onPick: (group: PromotionGroup) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link a promotion</DialogTitle>
          <DialogDescription>This product joins the offer at the till.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            className="text-muted pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            autoFocus
            className="pl-8"
            placeholder="Search promotions…"
            aria-label="Search promotions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {shown.length === 0 ? (
          <p className="text-muted p-3 text-center text-sm">
            {groups.length === 0 ? 'No other promotions set up yet.' : 'None match that.'}
          </p>
        ) : (
          <ul className="border-line divide-line max-h-72 divide-y overflow-y-auto rounded-md border">
            {shown.map((g) => (
              <li key={g.groupId}>
                <button
                  type="button"
                  className="hover:bg-paper-2/60 w-full px-3 py-2 text-left text-sm"
                  onClick={() => onPick(g)}
                >
                  <span className="text-ink block font-semibold">{g.name}</span>
                  <span className="text-muted tabular block text-xs">{dealSummary(g)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
