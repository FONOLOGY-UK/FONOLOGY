'use client';

import type { Sale } from '@/lib/data/types';
import { formatGBP, tenderLabel } from '@/lib/data/types';
import { CONTACT } from '@/lib/site';
import { RETURN_WINDOW_DAYS } from '@/lib/config';

/**
 * Printable till receipt (item 8). Hidden on screen; `printService` +
 * the `.print-area` rules put ONLY this on paper — thermal-width layout
 * (~72mm). PLACEHOLDER TEMPLATE pending the client's format (CONTENT-TODO).
 */
export function Receipt({ sale }: { sale: Sale }) {
  return (
    <div className="print-area hidden w-[270px] bg-white px-3 py-4 font-mono text-[11px] leading-snug text-black print:block">
      <div className="text-center">
        <p className="font-display text-lg font-extrabold uppercase tracking-tight">Fonology.</p>
        <p>{CONTACT.addressShort}</p>
        <p>
          {CONTACT.postcode} · {CONTACT.phone}
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
        <br />
        {RETURN_WINDOW_DAYS}-day returns with this receipt.
        <br />
        {CONTACT.email}
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
