import type { ReactNode } from 'react';
import { addressLines, mailtoHref } from '@/lib/data/types';
import { LEGAL_TRADER_NAME } from '@/lib/legal';

/**
 * Small pieces shared by the legal pages, the footer and the form notices. Styling is in
 * storefront-extend.css (`.legal-*`) so the pages keep the one reading measure and type scale
 * from LegalDocument.
 */

/**
 * A value the owner has to supply before launch. Rendered loudly on purpose: a bare `[[NAME]]`
 * on a live page is better caught by a quick read-through than by a customer.
 */
export function Ph({ name }: { name: string }) {
  return <mark className="legal-ph">[[{name}]]</mark>;
}

/** A short "in a nutshell" box at the top of a page, in plain English. */
export function LegalSummary({
  title = 'In short',
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside className="legal-summary" aria-label={title}>
      <p className="legal-summary__title">{title}</p>
      {children}
    </aside>
  );
}

/** A plain table that scrolls sideways on a phone rather than breaking the page. */
export function LegalTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="legal-table" role="region" tabIndex={0} aria-label="Table, scrolls sideways">
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What the law asks every UK company to show on its website, plus the ways to reach us. */
export function CompanyDetails({
  address,
  email,
  phone,
  heading = true,
}: {
  address: string | null;
  email: string | null;
  phone: string | null;
  heading?: boolean;
}) {
  const lines = addressLines(address);
  return (
    <div className="legal-company">
      {heading ? <p className="legal-company__title">Who we are</p> : null}
      <p>
        <strong>{LEGAL_TRADER_NAME}</strong> (trading as Fonology), a company registered in{' '}
        <Ph name="REGISTERED_IN" />, company number <Ph name="COMPANY_NUMBER" />.
      </p>
      <p>
        Registered office: <Ph name="REGISTERED_OFFICE" />
        {lines.length ? (
          <>
            <br />
            Shop and trading address: {lines.join(', ')}
          </>
        ) : null}
      </p>
      <p>
        {email ? (
          <>
            Email: <a href={mailtoHref(email)}>{email}</a>
            <br />
          </>
        ) : null}
        {phone ? <>Phone: {phone}</> : null}
      </p>
      <p>
        Registered with the Information Commissioner&rsquo;s Office, registration number{' '}
        <Ph name="ICO_REGISTRATION_NUMBER" />.
      </p>
    </div>
  );
}
