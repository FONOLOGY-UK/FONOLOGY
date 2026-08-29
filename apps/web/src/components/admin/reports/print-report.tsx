import { FonologyMark } from '@/components/storefront/art';
import { useShopDetails } from '@/lib/data/hooks';

/**
 * Shared branded print header/footer/table for Reports and Payments
 * (Round 5 #19). Both screens already print through the same `.print-area`
 * mechanism (admin.css) — window.print() -> the browser's own Save-as-PDF,
 * which is real PDF generation (selectable text, no rasterising) with none
 * of the extra infrastructure a library would need. See the comment on
 * `.print-area` in admin.css (Round 5 #19 addition) for why that stayed the
 * chosen approach rather than a new PDF-generation dependency: this task is
 * fundamentally about branding and layout, which print CSS delivers in
 * full, and every fact this header shows (address, phone) already has
 * exactly one source (`useShopDetails`, `shop_settings`) — this does not
 * add a sixth hardcoded copy of the shop's own details.
 */
export function PrintReportHeader({
  title,
  subtitle,
  from,
  to,
}: {
  title: string;
  subtitle: string;
  from: string;
  to: string;
}) {
  return (
    <header className="pr-header">
      <div className="pr-header__brand">
        <FonologyMark className="pr-header__mark" title="Fonology" />
        <div>
          <p className="pr-header__name">
            Fonology<span className="pr-header__dot">.</span>
          </p>
          <p className="pr-header__subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="pr-header__meta">
        <p className="pr-header__title">{title}</p>
        <p className="pr-header__range">
          {from} → {to}
        </p>
        <p className="pr-header__prepared">Prepared {new Date().toLocaleDateString('en-GB')}</p>
      </div>
    </header>
  );
}

/** Shop address/phone — real branding, not a re-typed sixth copy. */
export function PrintReportFooter({ note }: { note?: string }) {
  const { data: shop } = useShopDetails();
  return (
    <footer className="pr-footer">
      <p className="pr-footer__shop">
        {shop?.shopName ?? 'Fonology'}
        {shop?.shopAddress ? ` · ${shop.shopAddress}` : ''}
        {shop?.shopPhone ? ` · ${shop.shopPhone}` : ''}
      </p>
      {note ? <p className="pr-footer__note">{note}</p> : null}
    </footer>
  );
}

export function PrintReportStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="pr-stat">
      <dt className="pr-stat__label">{label}</dt>
      <dd className="pr-stat__value">{value}</dd>
    </div>
  );
}

export function PrintReportTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <section className="pr-table-section">
      <h2 className="pr-table-title">{title}</h2>
      <table className="pr-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={h} className={i === 0 ? 'is-left' : 'is-right'}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="pr-table__empty">
                Nothing in this range.
              </td>
            </tr>
          ) : (
            rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className={ci === 0 ? 'is-left' : 'is-right'}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
