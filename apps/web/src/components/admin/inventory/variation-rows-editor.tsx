'use client';

import { Check, Plus, Printer, X } from 'lucide-react';
import { useGenerateBarcode } from '@/lib/data/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** One variation being typed in. Blank price or cost follows the product's. */
export interface VariationRowDraft {
  key: string;
  name: string;
  barcode: string;
  stock: string;
  price: string;
  cost: string;
  imei: string;
  /** Print this line's shelf label as soon as it is saved. */
  printLabel: boolean;
}

export function newRowDraft(): VariationRowDraft {
  return {
    key: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    barcode: '',
    stock: '0',
    price: '',
    cost: '',
    imei: '',
    printLabel: false,
  };
}

/** The lines whose labels were asked for, by the name they are saved under. */
export function linesToPrint(rows: VariationRowDraft[]): string[] {
  return rows.filter((r) => r.printLabel && r.name.trim()).map((r) => r.name.trim());
}

const MONEY = /^\d+(\.\d{0,2})?$/;
const toPence = (pounds: string) => Math.round(Number(pounds) * 100);

export interface VariationRowValue {
  name: string;
  barcode: string | null;
  stockQty: number;
  price: number;
  costPrice: number;
  imei?: string | null;
}

/** Checks the rows and turns them into what the API takes, or says what is wrong. */
export function readRows(
  rows: VariationRowDraft[],
  defaults: { price: string; cost: string },
  opts: { requiresImei: boolean; canSeeCosts: boolean },
): { rows: VariationRowValue[]; error: null } | { rows: null; error: string } {
  const out: VariationRowValue[] = [];
  const names = new Set<string>();
  const filled = rows.filter((r) => r.name.trim() || r.barcode.trim());
  if (filled.length === 0) return { rows: null, error: 'Add at least one variation.' };
  for (const r of filled) {
    const name = r.name.trim();
    if (!name) return { rows: null, error: 'Every variation needs a name.' };
    const key = name.toLowerCase();
    if (names.has(key)) return { rows: null, error: `“${name}” is listed twice.` };
    names.add(key);
    if (!/^\d+$/.test(r.stock.trim())) {
      return { rows: null, error: `Enter the stock for ${name} (0 is fine).` };
    }
    const price = r.price.trim() || defaults.price.trim();
    if (!MONEY.test(price) || toPence(price) <= 0) {
      return { rows: null, error: `Enter a selling price for ${name}.` };
    }
    const cost = opts.canSeeCosts ? r.cost.trim() || defaults.cost.trim() : '0';
    if (!MONEY.test(cost)) return { rows: null, error: `Enter a cost price for ${name}.` };
    const imei = r.imei.trim();
    if (opts.requiresImei && !/^\d{15}$/.test(imei)) {
      return { rows: null, error: `${name} needs its 15-digit IMEI.` };
    }
    out.push({
      name,
      barcode: r.barcode.trim() || null,
      stockQty: Number(r.stock.trim()),
      price: toPence(price),
      costPrice: toPence(cost),
      ...(opts.requiresImei ? { imei } : {}),
    });
  }
  return { rows: out, error: null };
}

/**
 * Variations typed in one line at a time (client changes v2, 2.6). Price and cost start from the
 * product's and can be changed on any line. A line doesn't exist to print until it is saved, so Print
 * Label marks it, gives it a barcode if it has none, and the label prints as soon as it saves.
 */
export function VariationRowsEditor({
  rows,
  onChange,
  defaults,
  canSeeCosts,
  requiresImei,
}: {
  rows: VariationRowDraft[];
  onChange: (rows: VariationRowDraft[]) => void;
  defaults: { price: string; cost: string };
  canSeeCosts: boolean;
  requiresImei: boolean;
}) {
  const generate = useGenerateBarcode();
  const patch = (key: string, change: Partial<VariationRowDraft>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));

  return (
    <div className="grid gap-2">
      <div className="border-line rounded-ui border">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-paper-2/60 text-muted text-left text-[11px] uppercase tracking-[0.06em]">
            <tr>
              <th className="px-1.5 py-2">Variant name</th>
              <th className="w-40 px-1.5 py-2">Barcode</th>
              <th className="w-[68px] px-1.5 py-2">Stock</th>
              <th className="w-[76px] px-1.5 py-2">Price £</th>
              {canSeeCosts ? <th className="w-[76px] px-1.5 py-2">Cost £</th> : null}
              {requiresImei ? <th className="w-36 px-1.5 py-2">IMEI</th> : null}
              <th className="w-[122px] px-1.5 py-2">Label</th>
              <th className="w-9 px-1 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-line border-t">
                <td className="px-1.5 py-1.5">
                  <Input
                    aria-label="Variant name"
                    placeholder="e.g. Black"
                    className="h-9"
                    value={r.name}
                    onChange={(e) => patch(r.key, { name: e.target.value })}
                  />
                </td>
                <td className="px-1.5 py-1.5">
                  <div className="grid gap-0.5">
                    <Input
                      aria-label={`Barcode for ${r.name || 'this variation'}`}
                      placeholder="Scan or type"
                      className="tabular h-9 w-full min-w-0 px-2"
                      value={r.barcode}
                      onChange={(e) => patch(r.key, { barcode: e.target.value })}
                    />
                    {r.barcode.trim() ? null : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 justify-self-start px-1 text-xs"
                        disabled={generate.isPending}
                        onClick={async () => {
                          const code = await generate.mutateAsync().catch(() => null);
                          if (code) patch(r.key, { barcode: code });
                        }}
                      >
                        Generate
                      </Button>
                    )}
                  </div>
                </td>
                <td className="px-1.5 py-1.5">
                  <Input
                    aria-label={`Stock for ${r.name || 'this variation'}`}
                    inputMode="numeric"
                    className="tabular h-9 w-full min-w-0 px-1.5"
                    value={r.stock}
                    onChange={(e) => patch(r.key, { stock: e.target.value })}
                  />
                </td>
                <td className="px-1.5 py-1.5">
                  <Input
                    aria-label={`Price for ${r.name || 'this variation'}`}
                    inputMode="decimal"
                    className="tabular h-9 w-full min-w-0 px-1.5"
                    placeholder={defaults.price}
                    value={r.price}
                    onChange={(e) => patch(r.key, { price: e.target.value })}
                  />
                </td>
                {canSeeCosts ? (
                  <td className="px-1.5 py-1.5">
                    <Input
                      aria-label={`Cost for ${r.name || 'this variation'}`}
                      inputMode="decimal"
                      className="tabular h-9 w-full min-w-0 px-1.5"
                      placeholder={defaults.cost}
                      value={r.cost}
                      onChange={(e) => patch(r.key, { cost: e.target.value })}
                    />
                  </td>
                ) : null}
                {requiresImei ? (
                  <td className="px-1.5 py-1.5">
                    <Input
                      aria-label={`IMEI for ${r.name || 'this variation'}`}
                      inputMode="numeric"
                      maxLength={15}
                      placeholder="15 digits"
                      className="tabular h-9 w-full min-w-0 px-1.5"
                      value={r.imei}
                      onChange={(e) => patch(r.key, { imei: e.target.value.replace(/\D/g, '') })}
                    />
                  </td>
                ) : null}
                <td className="px-1.5 py-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={r.printLabel ? 'default' : 'outline'}
                    className="gap-1 whitespace-nowrap px-2"
                    aria-pressed={r.printLabel}
                    title={
                      r.printLabel
                        ? 'This label prints when you save. Press to cancel.'
                        : 'Print this label as soon as it is saved'
                    }
                    disabled={generate.isPending}
                    onClick={async () => {
                      if (r.printLabel) return patch(r.key, { printLabel: false });
                      const barcode =
                        r.barcode.trim() || (await generate.mutateAsync().catch(() => null));
                      // The hook has already said why a barcode couldn't be made.
                      if (barcode) patch(r.key, { barcode, printLabel: true });
                    }}
                  >
                    {r.printLabel ? <Check aria-hidden="true" /> : <Printer aria-hidden="true" />}
                    {r.printLabel ? 'On save' : 'Print Label'}
                  </Button>
                </td>
                <td className="px-1.5 py-1.5">
                  {rows.length > 1 ? (
                    <button
                      type="button"
                      className="text-muted hover:text-red-deep p-1"
                      aria-label={`Remove ${r.name || 'this line'}`}
                      onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                    >
                      <X className="size-4" />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-self-start"
        onClick={() => onChange([...rows, newRowDraft()])}
      >
        <Plus aria-hidden="true" />
        Add a line
      </Button>
    </div>
  );
}
