'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAdjustStock, useAdminProducts, useDeleteProduct, useSettings } from '@/lib/data/hooks';
import type { AdminProduct } from '@/lib/data/types';
import { PRODUCT_ART } from '@/components/storefront/art';
import { formatGBP, isLowStock, unitMargin } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';
import { cn } from '@/lib/utils';
import { ProductDialog } from './product-dialog';

/**
 * Inventory (item 7): the real stock truth — counts, cost, margin, supplier.
 * The storefront only ever shows the three-state status; the numbers live
 * here. Low-stock rows glow amber at the alert threshold (Settings).
 *
 * `hideCosts` (item 8): the employee panel reuses this module without the
 * cost/margin columns — permission `costs.view` in permissions.config.ts.
 */

type StockFilter = 'all' | 'low' | 'out';

export function InventoryView({ hideCosts = false }: { hideCosts?: boolean } = {}) {
  const searchParams = useSearchParams();
  const { data: products, isPending, isError, refetch } = useAdminProducts();
  const { data: settings } = useSettings();
  const adjustStock = useAdjustStock();
  const deleteProduct = useDeleteProduct();

  const threshold = settings?.lowStockThreshold ?? 5;

  const [filter, setFilter] = useState<StockFilter>(
    searchParams.get('filter') === 'low' ? 'low' : 'all',
  );
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<AdminProduct | null>(null);

  const lowCount = products?.filter((p) => isLowStock(p.stockQty, threshold)).length ?? 0;
  const outCount = products?.filter((p) => p.stockQty === 0).length ?? 0;

  const filtered = useMemo(() => {
    if (!products) return undefined;
    if (filter === 'low') return products.filter((p) => isLowStock(p.stockQty, threshold));
    if (filter === 'out') return products.filter((p) => p.stockQty === 0);
    return products;
  }, [products, filter, threshold]);

  const columns = useMemo<ColumnDef<AdminProduct>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Product',
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex items-center gap-2.5">
              <span
                className="admin-art bg-paper-2/60 size-9 shrink-0 rounded-md p-1"
                dangerouslySetInnerHTML={{ __html: PRODUCT_ART[p.art] ?? '' }}
                aria-hidden="true"
              />
              <div>
                <p className="text-ink font-semibold">{p.name}</p>
                <p className="text-muted text-xs">{p.sub}</p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'category',
        header: 'Category',
        cell: ({ row }) => {
          const p = row.original;
          return (
            <span className="capitalize">
              {p.category === 'plates' ? 'Plates' : p.category}
              {p.kind === 'vape' ? (
                <span className="text-muted ml-1 text-[10px] font-bold uppercase">in-store</span>
              ) : null}
            </span>
          );
        },
      },
      {
        accessorKey: 'price',
        header: 'Price',
        cell: ({ getValue }) => <span className="tabular">{formatGBP(getValue<number>())}</span>,
      },
      ...(hideCosts
        ? []
        : ([
            {
              accessorKey: 'costPrice',
              header: 'Cost',
              cell: ({ getValue }) => (
                <span className="tabular text-muted">{formatGBP(getValue<number>())}</span>
              ),
            },
            {
              id: 'margin',
              header: 'Margin',
              accessorFn: (p) => unitMargin(p.price, p.costPrice),
              cell: ({ getValue }) => (
                <span className="tabular">{Math.round(getValue<number>() * 100)}%</span>
              ),
            },
          ] satisfies ColumnDef<AdminProduct>[])),
      {
        accessorKey: 'stockQty',
        header: 'Stock',
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div
              className="border-line bg-paper inline-flex items-center rounded-md border"
              onClick={(e) => e.stopPropagation()}
            >
              <StepButton
                label={`One less ${p.name}`}
                disabled={p.stockQty === 0}
                onClick={() => adjustStock.mutate({ id: p.id, delta: -1 })}
              >
                <Minus className="size-3.5" aria-hidden="true" />
              </StepButton>
              <span
                className={cn(
                  'tabular min-w-[34px] px-1 text-center text-[13px] font-bold',
                  p.stockQty === 0
                    ? 'text-red-deep'
                    : isLowStock(p.stockQty, threshold)
                      ? 'text-warning'
                      : 'text-ink',
                )}
              >
                {p.stockQty}
              </span>
              <StepButton
                label={`One more ${p.name}`}
                onClick={() => adjustStock.mutate({ id: p.id, delta: 1 })}
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </StepButton>
            </div>
          );
        },
      },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (p) => p.stockStatus,
        cell: ({ row }) => {
          const p = row.original;
          if (p.stockQty === 0 && p.stockStatus === 'restocking') {
            return <StatusChip tone="accent">Restocking</StatusChip>;
          }
          if (p.stockQty === 0) return <StatusChip tone="danger">Out</StatusChip>;
          if (isLowStock(p.stockQty, threshold)) {
            return <StatusChip tone="warning">Low</StatusChip>;
          }
          return <StatusChip tone="success">In stock</StatusChip>;
        },
      },
      {
        accessorKey: 'supplier',
        header: 'Supplier',
        cell: ({ row }) => {
          const p = row.original;
          if (p.localBuying) {
            return (
              <StatusChip tone="neutral" className="normal-case">
                Local buy-in
              </StatusChip>
            );
          }
          return <span className="text-muted">{p.supplier ?? '—'}</span>;
        },
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              aria-label={`Edit ${row.original.name}`}
              onClick={() => {
                setEditing(row.original);
                setDialogOpen(true);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted hover:text-red-deep h-8 px-2"
              aria-label={`Delete ${row.original.name}`}
              onClick={() => setDeleting(row.original)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ),
      },
    ],
    [adjustStock, threshold, hideCosts],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Inventory"
        description={`Counts and costs live here — customers only ever see in stock / out of stock. Low-stock alert at ${threshold}.`}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus aria-hidden="true" />
            Add product
          </Button>
        }
      />

      <DataTable
        data={filtered}
        columns={columns}
        isLoading={isPending}
        isError={isError}
        errorMessage="The inventory didn’t load."
        onRetry={() => refetch()}
        searchPlaceholder="Search product, supplier, barcode…"
        pageSize={12}
        empty={{
          title: filter === 'all' ? 'No products yet' : 'Nothing here',
          description:
            filter === 'all'
              ? 'Add the first product to stock the shop.'
              : filter === 'low'
                ? 'Nothing is running low. Nice.'
                : 'Nothing is out of stock.',
        }}
        toolbar={
          <div className="flex gap-1.5" role="group" aria-label="Stock filter">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              All {products ? `· ${products.length}` : ''}
            </FilterChip>
            <FilterChip
              active={filter === 'low'}
              onClick={() => setFilter('low')}
              warn={lowCount > 0}
            >
              Low {lowCount > 0 ? `· ${lowCount}` : ''}
            </FilterChip>
            <FilterChip
              active={filter === 'out'}
              onClick={() => setFilter('out')}
              warn={outCount > 0}
            >
              Out {outCount > 0 ? `· ${outCount}` : ''}
            </FilterChip>
          </div>
        }
        rowClassName={(p) =>
          p.stockQty === 0
            ? 'bg-red-tint/30'
            : isLowStock(p.stockQty, threshold)
              ? 'bg-warning/5'
              : undefined
        }
      />

      <ProductDialog open={dialogOpen} onOpenChange={setDialogOpen} product={editing} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title="Delete this product?"
        description={
          deleting
            ? `${deleting.name} comes off the shop and the admin catalogue. This can't be undone here.`
            : undefined
        }
        confirmLabel="Delete product"
        destructive
        loading={deleteProduct.isPending}
        onConfirm={() => {
          if (!deleting) return;
          deleteProduct.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
        }}
      />
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="text-muted hover:text-ink px-1.5 py-1.5 transition-colors duration-150 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function FilterChip({
  active,
  warn,
  onClick,
  children,
}: {
  active: boolean;
  warn?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'tabular rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors duration-150',
        active
          ? 'bg-ink text-bone'
          : warn
            ? 'bg-warning/10 text-warning hover:text-ink'
            : 'bg-paper-2 text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
