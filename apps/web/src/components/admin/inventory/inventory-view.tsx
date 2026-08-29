'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  AlertTriangle,
  Check,
  Minus,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import {
  useAdjustStock,
  useAdminProducts,
  useDeleteProduct,
  useEnqueuePrintJob,
  useRestoreProduct,
  useLookupBarcode,
} from '@/lib/data/hooks';
import { useBarcodeScan } from '@/lib/scanner/use-barcode-scan';
import { scanFailSound, scanOkSound } from '@/lib/scanner/scan-sound';
import type { AdminProduct } from '@/lib/data/types';
import { PRODUCT_ART } from '@/components/storefront/art';
import { formatGBP, productIsLowStock, unitMargin } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { RowActionsMenu, type RowAction } from '@/components/admin/row-actions-menu';
import { StatusChip } from '@/components/admin/status-chip';
import { cn } from '@/lib/utils';
import { ProductDialog } from './product-dialog';

/**
 * Inventory (item 7): the real stock truth — counts, cost, margin, supplier.
 * The storefront only ever shows the three-state status; the numbers live
 * here. Low-stock rows glow amber at each product's own alert threshold.
 *
 * `hideCosts` (item 8): the employee panel reuses this module without the
 * cost/margin columns — permission `costs.view` in permissions.config.ts.
 */

type StockFilter = 'all' | 'low' | 'out' | 'retired';

/**
 * `initialFilter` is passed in by the page rather than read here with
 * `useSearchParams()`.
 *
 * That hook suspends so the component can bail out of prerendering, and on a
 * prerendered route the subtree never resumed — a direct load or refresh of
 * /admin/inventory sat on skeletons forever, and because the suspension
 * happened on the FIRST hook, `useAdminProducts()` below never ran, so no
 * request was ever made. In-app navigation worked, which is why it went
 * unnoticed. The page is a server component and already has the search
 * params; handing them down as a prop means nothing suspends at all.
 */
export function InventoryView({
  hideCosts = false,
  initialFilter = 'all',
}: { hideCosts?: boolean; initialFilter?: StockFilter } = {}) {
  const { data: products, isPending, isError, refetch } = useAdminProducts();
  const adjustStock = useAdjustStock();
  const deleteProduct = useDeleteProduct();
  const restoreProduct = useRestoreProduct();
  const enqueuePrint = useEnqueuePrintJob();

  const [filter, setFilter] = useState<StockFilter>(initialFilter);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<AdminProduct | null>(null);

  /* ---- barcode scanning ---------------------------------------------------
     Here a scan filters the table to the scanned product rather than adding
     it to anything — same capture mechanism, different destination. */
  const [search, setSearch] = useState('');
  const [scanResult, setScanResult] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const lookupBarcode = useLookupBarcode();
  const lookupRef = useRef(lookupBarcode.mutateAsync);
  lookupRef.current = lookupBarcode.mutateAsync;

  const onScan = useCallback(async (code: string) => {
    const barcode = code.trim();
    if (!barcode) return;
    try {
      const product = await lookupRef.current(barcode);
      if (!product) {
        // Leave the table alone on a miss: filtering to a barcode that
        // matches nothing would empty the screen and read as "the inventory
        // is gone" rather than "that code is unknown".
        setScanResult({ tone: 'bad', text: `No product has barcode ${barcode}` });
        scanFailSound();
        return;
      }
      // Filter by name, not barcode — a product whose barcode is missing from
      // the row's rendered text would otherwise filter to nothing despite
      // having just been found.
      setSearch(product.name);
      setScanResult({ tone: 'ok', text: `Found ${product.name}` });
      scanOkSound();
    } catch {
      setScanResult({ tone: 'bad', text: `Couldn’t look up ${barcode} — check the connection` });
      scanFailSound();
    }
  }, []);

  // Off while the product or delete dialog is open — the hook also refuses
  // while any dialog is up, this makes the intent explicit at the call site.
  useBarcodeScan((code) => void onScan(code), {
    enabled: !dialogOpen && deleting === null,
  });

  useEffect(() => {
    if (scanResult?.tone !== 'ok') return;
    const timer = setTimeout(() => setScanResult(null), 2600);
    return () => clearTimeout(timer);
  }, [scanResult]);

  /**
   * "Delete" on a product DEACTIVATES it (`is_active: false`) — it never
   * hard-deletes, because a product with sale history can't be removed and
   * an owner-managed catalogue shouldn't lose rows silently. See the DELETE
   * route in admin.routes.ts.
   *
   * This list showed retired products identically to live ones, so deleting
   * something appeared to do nothing: it vanished from the storefront (which
   * filters on is_active) while sitting unchanged in the till's inventory.
   * Reported during Step 4 click-testing as "it said deleted but I can still
   * see it".
   *
   * So retired rows now leave the working views entirely and get their own
   * chip. They stay reachable — retiring is reversible by editing the
   * product — but "All" means all the stock you can actually sell.
   *
   * `isActive` is optional in the schema (the mock predates the column), so
   * only an explicit `false` counts as retired.
   */
  const isRetired = (p: AdminProduct) => p.isActive === false;

  const live = useMemo(() => products?.filter((p) => !isRetired(p)), [products]);

  const lowCount = live?.filter((p) => productIsLowStock(p)).length ?? 0;
  const outCount = live?.filter((p) => p.stockQty === 0).length ?? 0;
  const retiredCount = products?.filter(isRetired).length ?? 0;

  const filtered = useMemo(() => {
    if (!products || !live) return undefined;
    if (filter === 'low') return live.filter((p) => productIsLowStock(p));
    if (filter === 'out') return live.filter((p) => p.stockQty === 0);
    if (filter === 'retired') return products.filter(isRetired);
    return live;
  }, [products, live, filter]);

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
                <p className="text-ink font-semibold">
                  {p.name}
                  {isRetired(p) ? (
                    <StatusChip tone="neutral" className="ml-1.5">
                      Retired
                    </StatusChip>
                  ) : null}
                </p>
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
                    : productIsLowStock(p)
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
          if (productIsLowStock(p)) {
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
        cell: ({ row }) => {
          const p = row.original;
          // Round 5 #11: this used to be up to three individual icon
          // buttons crammed into one cell (shelf label, only offered when
          // the product actually has a barcode — the label's whole job is
          // to be scannable at the till, and one with no symbol on it is a
          // price tag that makes staff type the name in by hand, the API
          // refuses it too; Edit; Restore-or-Delete). One 3-dot menu now.
          const actions: RowAction[] = [];
          if (p.barcode) {
            actions.push({
              label: 'Print shelf label',
              icon: <Printer />,
              disabled: enqueuePrint.isPending,
              onClick: () =>
                enqueuePrint.mutate({
                  kind: 'shelf_label',
                  entityId: p.id,
                  dedupeKey: `shelf-label-${p.id}-${Date.now()}`,
                }),
            });
          }
          actions.push({
            label: 'Edit',
            icon: <Pencil />,
            onClick: () => {
              setEditing(p);
              setDialogOpen(true);
            },
          });
          // Round 4 #BUG-10: a retired product gets Restore instead of
          // Delete — Delete on an already-retired row was a confusing
          // no-op (it just re-sets is_active: false, which is already
          // true), and there was no way at all to bring one back.
          if (isRetired(p)) {
            actions.push({
              label: 'Restore',
              icon: <RotateCcw />,
              disabled: restoreProduct.isPending,
              onClick: () => restoreProduct.mutate(p.id),
            });
          } else {
            actions.push({
              label: 'Delete',
              icon: <Trash2 />,
              tone: 'danger',
              onClick: () => setDeleting(p),
            });
          }
          return (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <RowActionsMenu actions={actions} srLabel={`Actions for ${p.name}`} />
            </div>
          );
        },
      },
    ],
    [adjustStock, enqueuePrint, hideCosts, restoreProduct],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Inventory"
        description="Counts and costs live here — customers only ever see in stock / out of stock. Each product carries its own low-stock alert."
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

      {scanResult ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'mb-3 flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-semibold',
            scanResult.tone === 'ok'
              ? 'border-green-600/30 bg-green-50 text-green-900'
              : 'border-red-deep/30 text-red-deep bg-red-50',
          )}
        >
          {scanResult.tone === 'ok' ? (
            <Check className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1">{scanResult.text}</span>
          <button
            type="button"
            onClick={() => setScanResult(null)}
            className="text-muted hover:text-ink p-0.5"
            aria-label="Dismiss scan message"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <DataTable
        data={filtered}
        columns={columns}
        isLoading={isPending}
        isError={isError}
        errorMessage="The inventory didn’t load."
        onRetry={() => refetch()}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search product, supplier, barcode…"
        pageSize={12}
        empty={{
          title: filter === 'all' ? 'No products yet' : 'Nothing here',
          description:
            filter === 'all'
              ? 'Add the first product to stock the shop.'
              : filter === 'low'
                ? 'Nothing is running low. Nice.'
                : filter === 'out'
                  ? 'Nothing is out of stock.'
                  : 'Nothing has been retired.',
        }}
        toolbar={
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Stock filter">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              All {live ? `· ${live.length}` : ''}
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
            {/* Only worth showing once something has actually been retired. */}
            {retiredCount > 0 ? (
              <FilterChip active={filter === 'retired'} onClick={() => setFilter('retired')}>
                Retired · {retiredCount}
              </FilterChip>
            ) : null}
          </div>
        }
        rowClassName={(p) =>
          p.stockQty === 0 ? 'bg-red-tint/30' : productIsLowStock(p) ? 'bg-warning/5' : undefined
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
