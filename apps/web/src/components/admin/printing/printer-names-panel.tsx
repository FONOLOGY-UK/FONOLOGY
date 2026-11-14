'use client';

import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { usePrinterNames, useSavePrinterNames } from '@/lib/data/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Which Windows printers this shop's till PC prints to. These used to be settable only by SQL on
 * the live database. A printer left blank isn't set up yet: the agent refuses that kind of job
 * (and says so on the device row) while the other printer keeps working — a shop can run with its
 * label printer alone until the receipt printer arrives.
 */
export function PrinterNamesPanel() {
  const names = usePrinterNames();
  const save = useSavePrinterNames();
  const [label, setLabel] = useState('');
  const [receipt, setReceipt] = useState('');

  useEffect(() => {
    if (!names.data) return;
    setLabel(names.data.label ?? '');
    setReceipt(names.data.receipt ?? '');
  }, [names.data]);

  const noShop = names.data && names.data.shopId === null;
  const changed =
    !!names.data &&
    (label.trim() !== (names.data.label ?? '') || receipt.trim() !== (names.data.receipt ?? ''));

  return (
    <section className="border-line bg-card rounded-lg border">
      <header className="border-line border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Printer className="size-4" aria-hidden /> Printer names on the till PC
        </h2>
        <p className="text-muted mt-0.5 text-xs">
          Exactly as Windows shows them (Settings, then Printers &amp; scanners). Leave one blank if
          this shop doesn&rsquo;t have that printer yet. The till PC picks a change up within a
          minute.
        </p>
      </header>
      {noShop ? (
        <p className="text-muted px-4 py-3 text-sm">
          Choose a shop at the top to set its printers.
        </p>
      ) : (
        <form
          className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ label: label.trim() || null, receipt: receipt.trim() || null });
          }}
        >
          <label className="grid gap-1 text-xs font-semibold">
            Label printer
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Not set up"
              autoComplete="off"
              disabled={!names.data}
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold">
            Receipt printer
            <Input
              value={receipt}
              onChange={(e) => setReceipt(e.target.value)}
              placeholder="Not set up"
              autoComplete="off"
              disabled={!names.data}
            />
          </label>
          <Button type="submit" disabled={!changed || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </form>
      )}
      {names.isError ? (
        <p className="px-4 pb-3 text-xs text-red-700 dark:text-red-400">
          The printer names didn&rsquo;t load.
        </p>
      ) : null}
    </section>
  );
}
