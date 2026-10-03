'use client';

import { useDeferredValue, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { useCopyMasterProduct, useMasterProducts } from '@/lib/data/hooks';
import type { AdminProduct } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/admin/status-chip';

/**
 * "Add Product from Master List": pull a product another shop already stocks into THIS shop.
 *
 * The master list is the set of products shops share. Adding one copies its name, photos,
 * description and variants into your shop's inventory with no stock and no cost of your own —
 * you set your own price, receive your own stock, and the website then sells both shops'
 * copies as one listing. You only ever see the product itself here, never another shop's
 * price, cost or stock.
 */
export function MasterPickerDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new copy, so the caller can open it to set a price and receive stock. */
  onAdded: (product: AdminProduct) => void;
}) {
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search.trim());
  const { data, isPending, isError } = useMasterProducts({ search: deferred }, open);
  const copy = useCopyMasterProduct();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add from the master list</DialogTitle>
          <DialogDescription>
            Products other shops already stock. Adding one puts it in your inventory with no stock —
            you set your own price and receive your own.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search
            className="text-muted pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            aria-label="Search the master list"
            className="pl-9"
          />
        </div>

        <div className="max-h-[360px] overflow-y-auto">
          {isError ? (
            <p className="text-red text-sm font-semibold">The master list didn’t load.</p>
          ) : isPending ? (
            <div className="grid gap-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : data.length === 0 ? (
            <p className="text-muted py-6 text-center text-sm">
              {deferred
                ? `Nothing on the master list matches “${deferred}”.`
                : 'The master list is empty.'}
            </p>
          ) : (
            <ul className="grid gap-2">
              {data.map((item) => (
                <li
                  key={item.id}
                  className="border-line flex items-center justify-between gap-3 rounded-md border p-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-ink truncate text-sm font-semibold">{item.name}</p>
                    <p className="text-muted truncate text-xs">
                      {item.sub}
                      {item.barcode ? ` · ${item.barcode}` : ''}
                    </p>
                  </div>
                  {item.inMyShop ? (
                    <StatusChip tone="success">
                      <Check className="mr-1 inline size-3" aria-hidden="true" />
                      In your shop
                    </StatusChip>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={copy.isPending}
                      onClick={() =>
                        copy.mutate(item.id, {
                          onSuccess: (product) => {
                            onOpenChange(false);
                            onAdded(product);
                          },
                        })
                      }
                    >
                      Add
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
