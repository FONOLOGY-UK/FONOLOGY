'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Check,
  CreditCard,
  Landmark,
  Minus,
  Plus,
  Printer,
  ScanBarcode,
  X,
} from 'lucide-react';
import {
  useAdminProducts,
  useCompleteSale,
  useLookupBarcode,
  usePromotions,
} from '@/lib/data/hooks';
import { useBarcodeScan } from '@/lib/scanner/use-barcode-scan';
import { scanFailSound, scanOkSound } from '@/lib/scanner/scan-sound';
import type { AdminProduct, Money, PosTender, Sale, SaleLine } from '@/lib/data/types';
import {
  formatGBP,
  productIsLowStock,
  promoUnitPrice,
  promotionFor,
  tenderLabel,
} from '@/lib/data/types';
import { cardMachine, type CardPaymentAttempt } from '@/lib/payments/card-machine';
import { printService } from '@/lib/print/print-service';
import { PrintButton } from '@/components/shared/print-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusChip } from '@/components/admin/status-chip';
import { cn } from '@/lib/utils';
import { Receipt } from './receipt';

/**
 * POS checkout (item 8) — built for speed at a physical counter.
 * Keyboard-first: the search box holds focus, a USB barcode scanner types
 * into it and Enter adds the exact match instantly. Bulk tiers apply
 * themselves at quantity thresholds. Split payments across Cash / POS 1 /
 * POS 2 / Online transfer with an unmissable remaining balance — including
 * card-on-card splits (part on one terminal, the rest on the other).
 */

/**
 * A payment portion's life:
 *   cash / transfer → `approved` immediately, amount editable
 *   card (POS 1/2)  → `pending` (set the amount, still editable)
 *                   → `waiting` (sent to the machine, locked)
 *                   → `approved`
 *
 * Cards get the `pending` step so a split across two terminals is possible:
 * type £30 on POS 1, send it, then the remaining £20 goes to POS 2. Charging
 * the full remainder the instant the button was pressed is what used to make
 * card splits impossible.
 */
interface PaymentPortion {
  id: string;
  tender: PosTender;
  amount: Money;
  status: 'pending' | 'waiting' | 'approved';
  attempt: CardPaymentAttempt | null;
  /**
   * Reference typed off the machine's receipt slip. Optional on purpose —
   * staff under pressure will skip it, and a required field would either
   * block a completed sale or train people to type junk.
   */
  reference: string;
}

const isCard = (tender: PosTender) => tender === 'pos1' || tender === 'pos2';

const TENDER_BUTTONS: { tender: PosTender; label: string; icon: typeof Banknote }[] = [
  { tender: 'cash', label: 'Cash', icon: Banknote },
  { tender: 'pos1', label: 'POS 1', icon: CreditCard },
  { tender: 'pos2', label: 'POS 2', icon: CreditCard },
  { tender: 'transfer', label: 'Transfer', icon: Landmark },
];

export function PosView() {
  const products = useAdminProducts();
  const { data: promotions } = usePromotions();
  const completeSale = useCompleteSale();

  const [lines, setLines] = useState<SaleLine[]>([]);
  const [discountMode, setDiscountMode] = useState<'percent' | 'amount'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [payments, setPayments] = useState<PaymentPortion[]>([]);
  const [completed, setCompleted] = useState<Sale | null>(null);
  // Optional — the backend never requires this, and below-cost sales must
  // never be blocked by its absence. See canComplete below: it doesn't
  // appear in that condition, on purpose.
  const [belowCostReason, setBelowCostReason] = useState('');

  const [search, setSearch] = useState('');
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * Result of the most recent scan. Success clears itself; failure does not —
   * a scan that didn't land has to stay on screen until the next scan
   * replaces it, because the costly mistake is staff believing an item is on
   * the ticket when it isn't.
   */
  const [scanResult, setScanResult] = useState<{
    tone: 'ok' | 'bad';
    text: string;
  } | null>(null);

  /* ---- pricing ------------------------------------------------------------ */

  const priceFor = useCallback(
    (product: AdminProduct, quantity: number): { unitPrice: Money; tierApplied: boolean } => {
      const promo = promotionFor(promotions, product.id);
      const tier = promo ? promoUnitPrice(promo, quantity) : null;
      return tier != null && tier < product.price
        ? { unitPrice: tier, tierApplied: true }
        : { unitPrice: product.price, tierApplied: false };
    },
    [promotions],
  );

  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const discount = useMemo(() => {
    const value = Number(discountValue) || 0;
    if (value <= 0) return 0;
    const pence =
      discountMode === 'percent'
        ? Math.round((subtotal * Math.min(100, value)) / 100)
        : Math.round(value * 100);
    return Math.min(subtotal, pence);
  }, [discountValue, discountMode, subtotal]);
  const total = Math.max(0, subtotal - discount);
  const costTotal = lines.reduce((s, l) => s + l.costPrice * l.quantity, 0);
  const belowCost = lines.length > 0 && total <= costTotal;

  const paidSoFar = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = total - paidSoFar;
  const allApproved = payments.every((p) => p.status === 'approved');

  const canComplete =
    lines.length > 0 &&
    payments.length > 0 &&
    remaining === 0 &&
    allApproved &&
    // Note: below-cost does NOT gate this. Migration 0008 fixes that rule —
    // a below-cost sale always completes, it just warns. The old
    // POS_CONFIG.blockBelowCost flag that used to sit here could be flipped
    // to contradict the schema, so it was removed.
    !completeSale.isPending;

  /* ---- ticket mutations (any change to the total voids taken payments) ---- */

  const resetPayments = useCallback(() => {
    setPayments((current) => {
      current.forEach((p) => p.attempt?.cancel());
      return [];
    });
  }, []);

  const addProduct = useCallback(
    (product: AdminProduct) => {
      // Same rule as the scan path below, applied here too: a retired
      // product still has a stock count and a barcode, so nothing else on
      // this screen stops it reaching the ticket. Refusing it at this one
      // choke point — tile tap, search-and-Enter, and the exact-barcode
      // Enter match all call this — beats catching it at Complete sale,
      // after the customer is already waiting.
      if (product.isActive === false) return;
      if (product.stockQty <= 0) return;
      completeSale.reset();
      resetPayments();
      setLines((current) => {
        const existing = current.find((l) => l.productId === product.id);
        const quantity = Math.min(product.stockQty, (existing?.quantity ?? 0) + 1);
        const { unitPrice, tierApplied } = priceFor(product, quantity);
        const line: SaleLine = {
          productId: product.id,
          name: product.name,
          sub: product.sub,
          quantity,
          unitPrice,
          listPrice: product.price,
          costPrice: product.costPrice,
          tierApplied,
        };
        return existing
          ? current.map((l) => (l.productId === product.id ? line : l))
          : [...current, line];
      });
      setSearch('');
      setHighlight(0);
      searchRef.current?.focus();
    },
    [priceFor, resetPayments, completeSale],
  );

  /* ---- barcode scanning --------------------------------------------------- */

  const lookupBarcode = useLookupBarcode();
  const lookupRef = useRef(lookupBarcode.mutateAsync);
  lookupRef.current = lookupBarcode.mutateAsync;

  const announceScan = useCallback((tone: 'ok' | 'bad', text: string) => {
    setScanResult({ tone, text });
    if (tone === 'ok') scanOkSound();
    else scanFailSound();
  }, []);

  const onScan = useCallback(
    async (code: string) => {
      const barcode = code.trim();
      if (!barcode) return;

      // The burst typed itself into the search box on its way past (we never
      // swallow characters). Clear it so the catalogue isn't left filtered by
      // a barcode that matches no product name.
      setSearch('');
      setHighlight(0);

      try {
        const product = await lookupRef.current(barcode);

        if (!product) {
          announceScan('bad', `No product has barcode ${barcode}`);
          return;
        }

        // A retired product still has its barcode, so the lookup happily
        // returns it — but the till refuses it at completion ("no longer
        // available"), which lands after the customer is already waiting.
        // Caught scanning a deactivated product on the real till: it went
        // onto the ticket and only failed on Complete sale. Say it now.
        if (product.isActive === false) {
          announceScan('bad', `${product.name} is retired — not for sale`);
          return;
        }

        // The till's existing rule is that an out-of-stock product cannot be
        // added — addProduct returns early on stockQty <= 0. Tapping one is
        // silently ignored, which is fine when you can see the button you
        // pressed. A scan has no such feedback, so we detect the same
        // condition here and say it out loud rather than changing the rule
        // or letting the scan look like it worked.
        if (product.stockQty <= 0) {
          announceScan('bad', `${product.name} — none in stock, not added`);
          return;
        }

        addProduct(product);
        announceScan('ok', `Added ${product.name}`);
      } catch {
        announceScan('bad', `Couldn’t look up ${barcode} — check the connection`);
      }
    },
    [addProduct, announceScan],
  );

  useBarcodeScan((code) => void onScan(code), {
    // Stand down while the sale is finished and the receipt is showing, and
    // while any dialog/PIN lock is up (the hook's own default).
    enabled: completed === null,
  });

  // A success message is transient; a failure stays until the next scan.
  useEffect(() => {
    if (scanResult?.tone !== 'ok') return;
    const timer = setTimeout(() => setScanResult(null), 2600);
    return () => clearTimeout(timer);
  }, [scanResult]);

  const setQuantity = useCallback(
    (productId: string, quantity: number) => {
      const product = products.data?.find((p) => p.id === productId);
      if (!product) return;
      resetPayments();
      if (quantity <= 0) {
        setLines((current) => current.filter((l) => l.productId !== productId));
        return;
      }
      const clamped = Math.min(product.stockQty, quantity);
      const { unitPrice, tierApplied } = priceFor(product, clamped);
      setLines((current) =>
        current.map((l) =>
          l.productId === productId ? { ...l, quantity: clamped, unitPrice, tierApplied } : l,
        ),
      );
    },
    [products.data, priceFor, resetPayments],
  );

  /* ---- payments ----------------------------------------------------------- */

  const addPayment = useCallback(
    (tender: PosTender) => {
      if (remaining <= 0) return;
      const id = `pay-${Date.now()}`;
      // Cards start PENDING so the amount can be trimmed before the machine is
      // asked for it. Cash and transfer settle on the spot.
      setPayments((c) => [
        ...c,
        {
          id,
          tender,
          amount: remaining,
          status: isCard(tender) ? 'pending' : 'approved',
          attempt: null,
          reference: '',
        },
      ]);
    },
    [remaining],
  );

  /** Start a card payment on the machine for the amount now showing. */
  const sendToMachine = useCallback((id: string) => {
    setPayments((current) => {
      const portion = current.find((p) => p.id === id);
      if (!portion || portion.status !== 'pending' || portion.amount <= 0) return current;
      // Only card portions ever reach `pending`; this also narrows the tender
      // to the two machines.
      if (portion.tender !== 'pos1' && portion.tender !== 'pos2') return current;

      const attempt = cardMachine.begin(portion.amount, portion.tender);
      void attempt.result.then((outcome) => {
        setPayments((c) =>
          outcome === 'approved'
            ? c.map((p) => (p.id === id ? { ...p, status: 'approved' } : p))
            : // Declined or cancelled at the machine: drop back to `pending`
              // with the amount intact, so the operator can retry on the other
              // machine or switch the whole portion to cash. The sale is never
              // stranded and nothing is recorded — only an approved leg is.
              c.map((p) => (p.id === id ? { ...p, status: 'pending', attempt: null } : p)),
        );
      });

      return current.map((p) => (p.id === id ? { ...p, status: 'waiting', attempt } : p));
    });
  }, []);

  const setPaymentAmount = useCallback((id: string, amountPounds: string) => {
    const pence = Math.max(0, Math.round((Number(amountPounds) || 0) * 100));
    setPayments((c) => c.map((p) => (p.id === id ? { ...p, amount: pence } : p)));
  }, []);

  const setPaymentReference = useCallback((id: string, reference: string) => {
    setPayments((c) => c.map((p) => (p.id === id ? { ...p, reference } : p)));
  }, []);

  const removePayment = useCallback((id: string) => {
    setPayments((c) => {
      const portion = c.find((p) => p.id === id);
      portion?.attempt?.cancel();
      return c.filter((p) => p.id !== id);
    });
  }, []);

  /* ---- completion --------------------------------------------------------- */

  const complete = () => {
    completeSale.mutate(
      {
        lines,
        discount,
        // The amount is the operator's split of the SERVER-computed total —
        // confirming a card payment records that money arrived, it never
        // decides how much. `reference` is whatever was typed off the slip,
        // omitted entirely when blank rather than sent as an empty string.
        payments: payments.map((p) => ({
          tender: p.tender,
          amount: p.amount,
          ...(p.reference.trim() ? { reference: p.reference.trim() } : {}),
        })),
        belowCostReason: belowCost && belowCostReason.trim() ? belowCostReason.trim() : undefined,
      },
      {
        onSuccess: (sale) => {
          setCompleted(sale);
          setLines([]);
          setPayments([]);
          setDiscountValue('');
          setBelowCostReason('');
        },
      },
    );
  };

  const newSale = () => {
    setCompleted(null);
    completeSale.reset();
    searchRef.current?.focus();
  };

  /* ---- search + keyboard -------------------------------------------------- */

  const filtered = useMemo(() => {
    // Retired products stay in `products.data` — Inventory's own "Retired"
    // filter needs them — but the till isn't that screen: nothing here
    // should be tappable, searchable or ticket-able once it's off sale.
    const list = (products.data ?? []).filter((p) => p.isActive !== false);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sub.toLowerCase().includes(q) ||
        (p.barcode ?? '').includes(q),
    );
  }, [products.data, search]);

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Barcode scanners type the code + Enter: exact match wins instantly.
      const exact = products.data?.find((p) => p.barcode === search.trim());
      const target = exact ?? filtered[highlight] ?? filtered[0];
      if (target) addProduct(target);
    } else if (e.key === 'Escape') {
      setSearch('');
      setHighlight(0);
    }
  };

  useEffect(() => setHighlight(0), [search]);

  /* ---- render ------------------------------------------------------------- */

  /*
    On a counter screen (xl and up) the till is a FIXED-HEIGHT two-pane app,
    not a document: the grid below is exactly the viewport minus the 53px
    header, and each pane scrolls its own content. That keeps the totals and
    the payment buttons permanently on screen — the operator was previously
    having to scroll the whole page to reach "Complete sale", with the
    customer stood waiting.

    Below xl the panes stack, and a fixed height would squash the ticket into
    a sliver, so there it stays `min-h` and the page scrolls normally.
  */
  return (
    <div className="grid min-h-[calc(100vh-53px)] xl:h-[calc(100vh-53px)] xl:grid-cols-[1fr_440px] xl:overflow-hidden">
      {/* Catalogue side */}
      <section className="flex min-w-0 flex-col p-4 xl:min-h-0 print:hidden">
        <div className="relative mb-3">
          <ScanBarcode
            className="text-muted pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            ref={searchRef}
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Scan a barcode or type to search — Enter adds"
            className="h-14 pl-12 text-base"
            aria-label="Scan or search products"
          />
        </div>

        {/*
          Scan feedback. role="status" (polite) rather than "alert" so it is
          announced without interrupting, and aria-live keeps it useful when
          the operator is looking at the customer rather than the screen.
        */}
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
            {scanResult.tone === 'bad' ? (
              <button
                type="button"
                onClick={() => setScanResult(null)}
                className="text-red-deep/70 hover:text-red-deep p-0.5"
                aria-label="Dismiss scan error"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        ) : null}

        {products.isError ? (
          <div className="border-line bg-card rounded-lg border p-8 text-center">
            <p className="text-ink mb-3 text-sm font-semibold">The catalogue didn’t load.</p>
            <Button variant="outline" size="sm" onClick={() => products.refetch()}>
              Try again
            </Button>
          </div>
        ) : products.isPending ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[92px]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No match"
            description={`Nothing matches “${search}”. Check the spelling or the barcode.`}
          />
        ) : (
          /*
            min-h-0 is what makes flex-1 + overflow-y-auto actually clip: a
            flex item defaults to min-height:auto and refuses to shrink below
            its content, so without it the catalogue pushes the pane taller
            than the viewport instead of scrolling inside it.
          */
          <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto md:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((product, i) => {
              const out = product.stockQty <= 0;
              return (
                <button
                  key={product.id}
                  onClick={() => addProduct(product)}
                  disabled={out}
                  className={cn(
                    'border-line bg-card rounded-lg border p-3 text-left transition-colors duration-150',
                    out
                      ? 'cursor-not-allowed opacity-45'
                      : 'hover:border-red active:bg-red-tint/60',
                    i === highlight && search && !out && 'border-red ring-red ring-1',
                  )}
                >
                  <p className="text-ink truncate text-[13px] font-bold">{product.name}</p>
                  <p className="text-muted truncate text-[11px]">{product.sub}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="tabular text-ink text-sm font-extrabold">
                      {formatGBP(product.price)}
                    </span>
                    <span
                      className={cn(
                        'tabular text-[11px] font-bold',
                        out
                          ? 'text-red-deep'
                          : productIsLowStock(product)
                            ? 'text-warning'
                            : 'text-muted',
                      )}
                    >
                      {out ? 'Out' : `×${product.stockQty}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Ticket side */}
      <aside className="border-line bg-card flex flex-col border-t xl:min-h-0 xl:border-l xl:border-t-0 print:hidden">
        {completed ? (
          <SaleDone sale={completed} onNewSale={newSale} />
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <p className="text-muted mb-2 text-[11px] font-bold uppercase tracking-[0.14em]">
                Ticket
              </p>
              {lines.length === 0 ? (
                <p className="text-muted py-10 text-center text-sm">
                  Scan or tap a product to start.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {lines.map((line) => (
                    <li key={line.productId} className="border-line rounded-md border p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-ink truncate text-[13px] font-bold">{line.name}</p>
                          <p className="text-muted tabular text-[11px]">
                            {formatGBP(line.unitPrice)} each
                            {line.tierApplied ? (
                              <StatusChip tone="accent" className="ml-1.5">
                                Bulk deal
                              </StatusChip>
                            ) : null}
                          </p>
                        </div>
                        <button
                          onClick={() => setQuantity(line.productId, 0)}
                          className="text-muted hover:text-red-deep p-1"
                          aria-label={`Remove ${line.name}`}
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="border-line bg-paper inline-flex items-center rounded-md border">
                          <QtyButton
                            label={`One less ${line.name}`}
                            onClick={() => setQuantity(line.productId, line.quantity - 1)}
                          >
                            <Minus className="size-4" aria-hidden="true" />
                          </QtyButton>
                          <span className="tabular min-w-[40px] text-center text-sm font-extrabold">
                            {line.quantity}
                          </span>
                          <QtyButton
                            label={`One more ${line.name}`}
                            onClick={() => setQuantity(line.productId, line.quantity + 1)}
                          >
                            <Plus className="size-4" aria-hidden="true" />
                          </QtyButton>
                        </div>
                        <span className="tabular text-ink text-sm font-extrabold">
                          {formatGBP(line.unitPrice * line.quantity)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/*
              shrink-0: the money half of the ticket — discount, totals, the
              tender buttons and Complete sale — is never allowed to be
              compressed or pushed off screen. The ticket LINES above absorb
              the squeeze instead (they scroll); these controls always stay
              where the operator's hand expects them.
            */}
            <div className="border-line grid shrink-0 gap-3 border-t p-4">
              {/* Discount */}
              <div className="flex items-center gap-2">
                <span className="text-muted flex-1 text-[11px] font-bold uppercase tracking-[0.14em]">
                  Discount
                </span>
                <div
                  className="border-line bg-paper inline-flex rounded-md border p-0.5"
                  role="group"
                  aria-label="Discount type"
                >
                  {(['percent', 'amount'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setDiscountMode(mode)}
                      aria-pressed={discountMode === mode}
                      className={cn(
                        'rounded px-2 py-1 text-xs font-bold',
                        discountMode === mode ? 'bg-ink text-bone' : 'text-muted',
                      )}
                    >
                      {mode === 'percent' ? '%' : '£'}
                    </button>
                  ))}
                </div>
                <Input
                  type="number"
                  min="0"
                  step={discountMode === 'percent' ? '1' : '0.01'}
                  inputMode="decimal"
                  value={discountValue}
                  onChange={(e) => {
                    resetPayments();
                    setDiscountValue(e.target.value);
                  }}
                  // A scroll while this stays focused shouldn't silently
                  // change a money amount via the native number spinner.
                  onWheel={(e) => e.currentTarget.blur()}
                  className="tabular h-9 w-24 text-right"
                  aria-label={`Discount ${discountMode === 'percent' ? 'percentage' : 'in pounds'}`}
                />
              </div>

              {/* Totals */}
              <div className="grid gap-0.5 text-sm">
                <p className="text-muted flex justify-between">
                  <span>Subtotal</span>
                  <span className="tabular">{formatGBP(subtotal)}</span>
                </p>
                {discount > 0 ? (
                  <p className="text-red-deep flex justify-between font-semibold">
                    <span>Discount</span>
                    <span className="tabular">−{formatGBP(discount)}</span>
                  </p>
                ) : null}
                <p className="text-ink flex items-baseline justify-between">
                  <span className="font-bold uppercase">Total</span>
                  <span className="font-display tabular text-3xl font-extrabold tracking-tight">
                    {formatGBP(total)}
                  </span>
                </p>
              </div>

              {belowCost ? (
                <div
                  className="border-warning/50 bg-warning/10 text-ink-2 flex flex-col gap-2 rounded-md border px-3 py-2 text-xs font-semibold"
                  role="alert"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      className="text-warning mt-0.5 size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      This total is at or below cost ({formatGBP(costTotal)}). The sale can still go
                      through.
                    </span>
                  </div>
                  <input
                    type="text"
                    value={belowCostReason}
                    onChange={(e) => setBelowCostReason(e.target.value)}
                    placeholder="Reason (optional) — e.g. damaged stock, staff discount, price match"
                    aria-label="Reason for below-cost sale (optional)"
                    className="border-line bg-background text-ink w-full rounded border px-2 py-1.5 text-xs font-normal"
                  />
                </div>
              ) : null}

              {/* Payments */}
              {lines.length > 0 ? (
                <div className="grid gap-2">
                  {payments.length > 0 ? (
                    <ul className="grid gap-1.5">
                      {payments.map((p) => (
                        <li
                          key={p.id}
                          className={cn(
                            'flex flex-wrap items-center gap-2 rounded-md px-2.5 py-2 text-[13px]',
                            p.status === 'waiting' ? 'bg-blush' : 'bg-paper-2/70',
                          )}
                        >
                          <span className="text-ink flex-1 font-semibold">
                            {tenderLabel(p.tender)}
                          </span>

                          {p.status === 'waiting' ? (
                            <>
                              <span className="text-red-deep animate-pulse text-xs font-bold">
                                Waiting for card… {formatGBP(p.amount)}
                              </span>
                              <Button
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => p.attempt?.confirm()}
                              >
                                Card approved
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => p.attempt?.cancel()}
                              >
                                Declined
                              </Button>
                              <button
                                type="button"
                                onClick={() => removePayment(p.id)}
                                className="text-muted hover:text-red-deep p-1"
                                aria-label={`Remove the ${tenderLabel(p.tender)} portion`}
                              >
                                <X className="size-3.5" />
                              </button>
                            </>
                          ) : (
                            <>
                              {/* Amount is editable for cash/transfer, and for a card
                                  portion until it's sent — that's what makes a split
                                  across POS 1 and POS 2 possible. */}
                              {p.status === 'pending' || !isCard(p.tender) ? (
                                <div className="relative">
                                  <span className="text-muted absolute left-2 top-1/2 -translate-y-1/2 text-xs">
                                    £
                                  </span>
                                  {/* Uncontrolled on purpose: reformatting a controlled
                                      value mid-keystroke fights the cursor. Keyed per
                                      portion so a re-add starts fresh. */}
                                  <Input
                                    key={p.id}
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    inputMode="decimal"
                                    defaultValue={(p.amount / 100).toFixed(2)}
                                    onChange={(e) => setPaymentAmount(p.id, e.target.value)}
                                    // Same reasoning as the discount input above —
                                    // a busy till is exactly where an accidental
                                    // scroll-while-focused amount change is likely.
                                    onWheel={(e) => e.currentTarget.blur()}
                                    className="tabular h-8 w-24 pl-6 text-right text-[13px]"
                                    aria-label={`${tenderLabel(p.tender)} amount`}
                                  />
                                </div>
                              ) : (
                                <span className="tabular font-bold">{formatGBP(p.amount)}</span>
                              )}

                              {p.status === 'pending' ? (
                                <Button
                                  size="sm"
                                  className="h-8 px-2.5 text-[11px]"
                                  disabled={p.amount <= 0}
                                  onClick={() => sendToMachine(p.id)}
                                  title={`Send ${formatGBP(p.amount)} to ${tenderLabel(p.tender)}`}
                                >
                                  Send to machine
                                </Button>
                              ) : null}

                              <button
                                onClick={() => removePayment(p.id)}
                                className="text-muted hover:text-red-deep p-1"
                                aria-label={`Remove ${tenderLabel(p.tender)} payment`}
                              >
                                <X className="size-3.5" />
                              </button>

                              {/* Slip reference, once the machine has approved.
                                  Always optional: a busy counter will skip it,
                                  and demanding it would either block a finished
                                  sale or produce junk data. */}
                              {p.status === 'approved' && isCard(p.tender) ? (
                                <Input
                                  value={p.reference}
                                  onChange={(e) => setPaymentReference(p.id, e.target.value)}
                                  placeholder="Slip ref (optional)"
                                  aria-label={`${tenderLabel(p.tender)} receipt reference (optional)`}
                                  className="h-8 w-full text-[12px]"
                                />
                              ) : null}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {/* Remaining — unmissable */}
                  {payments.length > 0 ? (
                    <p
                      className={cn(
                        'tabular rounded-md px-3 py-2 text-center text-sm font-extrabold',
                        remaining === 0
                          ? 'bg-success/10 text-success'
                          : remaining < 0
                            ? 'bg-red-tint text-red-deep'
                            : 'bg-paper-2 text-ink',
                      )}
                      aria-live="polite"
                    >
                      {remaining < 0
                        ? `Over by ${formatGBP(-remaining)} — take some off`
                        : remaining > 0
                          ? `Remaining ${formatGBP(remaining)}`
                          : allApproved
                            ? 'Fully paid'
                            : // Covered on paper, but a card hasn't gone through yet.
                              'Send the card payment to finish'}
                    </p>
                  ) : null}

                  {remaining > 0 ? (
                    <div className="grid grid-cols-4 gap-1.5">
                      {TENDER_BUTTONS.map(({ tender, label, icon: Icon }) => (
                        <button
                          key={tender}
                          onClick={() => addPayment(tender)}
                          className="border-line bg-paper hover:border-red hover:text-red rounded-md border py-2.5 text-center transition-colors duration-150"
                          title={`Take ${formatGBP(remaining)} by ${tenderLabel(tender)}`}
                        >
                          <Icon className="mx-auto size-4" aria-hidden="true" />
                          <span className="mt-1 block text-[11px] font-bold uppercase">
                            {label}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {completeSale.isError ? (
                    <p className="text-red-deep text-xs font-semibold" role="alert">
                      {completeSale.error.message}
                    </p>
                  ) : null}

                  <Button
                    size="lg"
                    className="h-14 text-base"
                    disabled={!canComplete}
                    onClick={complete}
                  >
                    {completeSale.isPending ? 'Completing…' : `Complete sale · ${formatGBP(total)}`}
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </aside>

      {completed ? <Receipt sale={completed} /> : null}
    </div>
  );
}

function QtyButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="text-muted hover:text-ink px-2.5 py-2 transition-colors duration-150"
    >
      {children}
    </button>
  );
}

function SaleDone({ sale, onNewSale }: { sale: Sale; onNewSale: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="bg-success/10 flex size-14 items-center justify-center rounded-full">
        <Check className="text-success size-6" aria-hidden="true" />
      </span>
      <div>
        <p className="font-display text-ink text-xl font-extrabold uppercase">Sale complete</p>
        <p className="text-muted tabular mt-1 text-sm">
          {sale.reference} · {formatGBP(sale.total)}
        </p>
        <ul className="text-muted mt-2 text-xs">
          {sale.payments.map((p, i) => (
            <li key={i} className="tabular">
              {tenderLabel(p.tender)} — {formatGBP(p.amount)}
            </li>
          ))}
        </ul>
      </div>
      {/*
        RECEIPTS ARE ON DEMAND, NOT AUTOMATIC. Client-confirmed: "we do print
        receipts from the direct system if customer needs". So this is a button
        someone presses when the customer asks, and a sale that completes with
        nobody pressing it is the normal case — not a missed print.

        `dedupeKey` is the sale id, so pressing it twice is a no-op rather than
        two receipts. That matters more here than anywhere else on the till:
        two receipts for one sale is what a fraudulent return looks like.
      */}
      <div className="grid w-full max-w-[260px] gap-2">
        <PrintButton
          kind="sale_receipt"
          entityId={sale.id}
          dedupeKey={`sale-receipt-${sale.id}`}
          label="Print receipt"
        />
        {/*
          The old browser-print path, kept deliberately.

          It prints a DIFFERENT receipt from the agent (no barcode, no card
          slip reference), which is a real problem — but it is what works
          today, and no receipt at all is worse than two that differ. Retire
          this once the agent is proven on the shop's real hardware; see
          HANDOVER-PRINTING.md §9.6.
        */}
        <Button variant="ghost" size="sm" onClick={() => printService.printReceipt()}>
          <Printer aria-hidden="true" />
          Print via browser (fallback)
        </Button>
        <Button onClick={onNewSale} size="lg" className="h-12">
          New sale
        </Button>
      </div>
    </div>
  );
}
