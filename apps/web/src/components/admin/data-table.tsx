'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type SortingState,
  type Updater,
} from '@tanstack/react-table';
import { AlertTriangle, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { cn } from '@/lib/utils';

/**
 * THE admin table. Every list in the back office renders through this one
 * component so loading skeletons, error+retry, empty states, search, sort and
 * pagination behave identically everywhere (item 7 requirement). Dense but
 * readable: 13px rows, uppercase micro-headers, tabular numerals.
 *
 * Press "/" to jump to the search box.
 */
export function DataTable<TData>({
  data,
  columns,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  searchable = true,
  searchPlaceholder = 'Search…',
  globalFilterFn,
  empty,
  toolbar,
  pageSize = 10,
  onRowClick,
  rowClassName,
  search,
  onSearchChange,
}: {
  data: TData[] | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Row-level predicate for the search box (default: JSON text match). */
  globalFilterFn?: (row: TData, query: string) => boolean;
  empty: { title: string; description?: string; action?: ReactNode };
  /** Filter chips etc., rendered beside the search box. */
  toolbar?: ReactNode;
  pageSize?: number;
  onRowClick?: (row: TData) => void;
  rowClassName?: (row: TData) => string | undefined;
  /**
   * Optional controlled search. Omit both and the table owns its own search
   * state exactly as before — every existing caller is unaffected. Pass both
   * to drive the box from outside, which is how a barcode scan filters the
   * table to the scanned product.
   */
  search?: string;
  onSearchChange?: (value: string) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [internalFilter, setInternalFilter] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Controlled when the caller supplies both props, uncontrolled otherwise.
  const isControlled = search !== undefined && onSearchChange !== undefined;
  const globalFilter = isControlled ? search : internalFilter;
  const setGlobalFilter = isControlled ? onSearchChange : setInternalFilter;

  // "/" focuses search — unless the user is already typing somewhere.
  useEffect(() => {
    if (!searchable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchable]);

  const table = useReactTable({
    data: data ?? [],
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    // TanStack hands back either a value or an updater function; the
    // controlled callback only takes a value, so resolve it here.
    onGlobalFilterChange: (updater: Updater<string>) =>
      setGlobalFilter(typeof updater === 'function' ? updater(globalFilter) : updater),
    globalFilterFn: (row: Row<TData>, _columnId, value: string) => {
      const query = value.trim().toLowerCase();
      if (!query) return true;
      if (globalFilterFn) return globalFilterFn(row.original, query);
      return JSON.stringify(row.original).toLowerCase().includes(query);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.getState().pagination;
  const rangeStart = filteredCount === 0 ? 0 : pageIndex * pageSize + 1;
  const rangeEnd = Math.min(filteredCount, (pageIndex + 1) * pageSize);

  return (
    <div className="bg-card border-line rounded-lg border">
      {(searchable || toolbar) && (
        <div className="border-line flex flex-wrap items-center gap-2 border-b p-3">
          {searchable && (
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search
                className="text-muted pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                ref={searchRef}
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 pl-9"
                aria-label={searchPlaceholder}
              />
              <kbd className="border-line text-muted pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border px-1.5 text-[10px] sm:block">
                /
              </kbd>
            </div>
          )}
          {toolbar}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-line border-b">
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const dir = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className="text-muted whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.1em]"
                    >
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          className={cn(
                            'hover:text-ink inline-flex items-center gap-1 transition-colors',
                            dir && 'text-ink',
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                          title="Sort"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <ArrowUpDown
                            className={cn('size-3', dir ? 'opacity-100' : 'opacity-40')}
                            aria-hidden="true"
                          />
                          {dir ? (
                            <span className="sr-only">
                              sorted {dir === 'asc' ? 'ascending' : 'descending'}
                            </span>
                          ) : null}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-line border-b last:border-0">
                  {columns.map((_col, j) => (
                    <td key={j} className="px-3 py-3">
                      <Skeleton className="h-4 w-full max-w-[120px]" />
                    </td>
                  ))}
                </tr>
              ))
            ) : isError ? (
              <tr>
                <td colSpan={columns.length}>
                  <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                    <AlertTriangle className="text-red-deep size-6" aria-hidden="true" />
                    <p className="text-ink text-sm font-semibold">
                      {errorMessage ?? 'This list didn’t load.'}
                    </p>
                    {onRetry ? (
                      <Button variant="outline" size="sm" onClick={onRetry}>
                        Try again
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  {globalFilter ? (
                    <EmptyState
                      title="No matches"
                      description={`Nothing matches “${globalFilter}”. Try a different search.`}
                      className="py-12"
                    />
                  ) : (
                    <EmptyState
                      title={empty.title}
                      description={empty.description}
                      action={empty.action}
                      className="py-12"
                    />
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-line border-b transition-colors last:border-0',
                    onRowClick && 'hover:bg-paper-2/40 cursor-pointer',
                    rowClassName?.(row.original),
                  )}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="whitespace-nowrap px-3 py-2.5 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && !isError && filteredCount > pageSize ? (
        <div className="border-line flex items-center justify-between border-t px-3 py-2">
          <p className="text-muted tabular text-xs">
            {rangeStart}–{rangeEnd} of {filteredCount}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
