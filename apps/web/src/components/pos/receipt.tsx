'use client';

import type { Sale } from '@/lib/data/types';
import { formatGBP, tenderLabel } from '@/lib/data/types';
import { useShopDetails } from '@/lib/data/hooks';
import { addressShort, addressPostcode } from '@/lib/data/types';

/**
 * Printable till receipt (item 8). Hidden on screen; `printService` +
 * the `.print-area` rules put ONLY this on paper — thermal-width layout
 * (~72mm). PLACEHOLDER TEMPLATE pending the client's format (CONTENT-TODO).
 *
 * EVERY shop fact here comes from `GET /shop`, never from a constant.
 *
 * Two bugs are buried in that sentence, both found the hard way:
 *
 * 1. The returns window used to be the hardcoded `RETURN_WINDOW_DAYS = 30`
 *    while returns-view.tsx enforced the configurable column — so an owner
 *    setting 14 days handed the customer a printed guarantee of 30.
 * 2. Fixing that with `useSettings()` was WORSE. `GET /admin/settings`
 *    requires `settings.manage`, which counter staff do not hold, so for the
 *    only people who actually print receipts the request failed and the
 *    returns line silently vanished — while owners saw it working. Quiet
 *    wrong output, which is the failure mode this shop can least afford.
 *
 * `useShopDetails()` is public and works for everyone.
 */
export function Receipt({ sale }: { sale: Sale }) {
  const { data: shop } = useShopDetails();
  const returnWindowDays = shop?.returnWindowDays;
  return (
    <div className="print-area hidden w-[270px] bg-white px-3 py-4 font-mono text-[11px] leading-snug text-black print:block">
      <div className="text-center">
        {/* "Fonology" only — not the registered company name. Client-confirmed. */}
        <p className="font-display text-lg font-extrabold uppercase tracking-tight">
          {shop?.shopName ?? 'Fonology'}
        </p>
        <p>{addressShort(shop?.shopAddress ?? null)}</p>
        <p>
          {addressPostcode(shop?.shopAddress ?? null)}
          {shop?.shopPhone ? ` · ${shop.shopPhone}` : ''}
        </p>
      </div>

      <p className="my-2 border-y border-dashed border-black py-1 text-center">
        {sale.reference} ·{' '}
        {new Date(sale.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
      </p>

      <table className="w-full">
        <tbody>
          {sale.lines.map((line, i) => (
            <tr key={i} className="align-top">
              <td className="pr-1">{line.quantity}×</td>
              <td className="pr-2">
                {line.name}
                {line.tierApplied ? (
                  <>
                    <br />
                    <span>· bulk price applied</span>
                  </>
                ) : null}
              </td>
              <td className="text-right">{formatGBP(line.unitPrice * line.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 border-t border-dashed border-black pt-1">
        <Row label="Subtotal" value={formatGBP(sale.subtotal)} />
        {sale.discount > 0 ? <Row label="Discount" value={`−${formatGBP(sale.discount)}`} /> : null}
        <Row label="TOTAL" value={formatGBP(sale.total)} bold />
        {sale.payments.map((p, i) => (
          <Row key={i} label={tenderLabel(p.tender)} value={formatGBP(p.amount)} />
        ))}
      </div>

      <p className="mt-3 text-center">
        Thanks for shopping local.
        {/*
          No number until we know the real one. If the details haven't loaded
          the returns line is omitted rather than printed with a guess — a
          receipt promising the wrong window is worse than one promising
          nothing, because the customer keeps the paper.
        */}
        {returnWindowDays != null ? (
          <>
            <br />
            {returnWindowDays}-day returns with this receipt.
          </>
        ) : null}
        {/*
          Owner-editable small print (the 90-day repair warranty). Kept
          SEPARATE from the returns line above on purpose: that line stays
          generated from return_window_days so free text can never contradict
          the number the refund screen actually enforces.
        */}
        {shop?.receiptFooterText ? (
          <>
            <br />
            {shop.receiptFooterText}
          </>
        ) : null}
        {shop?.shopEmail ? (
          <>
            <br />
            {shop.shopEmail}
          </>
        ) : null}
      </p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <p className={`flex justify-between ${bold ? 'text-[13px] font-bold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </p>
  );
}
