import type { Response } from 'express';
import PDFDocument from 'pdfkit';

/**
 * A plain, branded A4-landscape table, streamed to the response as a PDF download — the
 * inventory logs' "Download PDF" (0103/0104). pdfkit with its built-in Helvetica: no headless
 * browser, no font files, nothing in the image beyond node_modules.
 *
 * Built-in fonts are WinAnsi: £ and – are fine, arrows and emoji are not — callers keep to
 * plain text.
 */

export interface PdfColumn {
  header: string;
  /** Share of the table width; the shares are scaled to fit. */
  width: number;
  align?: 'left' | 'right';
}

export interface LogReport {
  filename: string;
  shopName: string;
  title: string;
  /** "Shop: Thornliebank · 1 Oct 2026 – 7 Oct 2026" etc., one line each. */
  meta: string[];
  columns: PdfColumn[];
  rows: string[][];
  /** Shown under the table when the export was capped. */
  footnote?: string;
}

const INK = '#141414';
const MUTED = '#6b6660';
const LINE = '#d9d4cc';
const RED = '#e8250c';

export function sendLogReport(res: Response, report: LogReport): void {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 40, bottom: 40, left: 36, right: 36 },
    bufferPages: true,
    info: { Title: `${report.shopName} — ${report.title}`, Author: report.shopName },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  doc.pipe(res);

  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 14;
  const total = report.columns.reduce((n, c) => n + c.width, 0);
  const widths = report.columns.map((c) => (c.width / total) * usable);
  const xs = widths.map((_, i) => left + widths.slice(0, i).reduce((n, w) => n + w, 0));
  const pad = 4;

  // Header block, first page only.
  doc
    .fillColor(RED)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(report.shopName.toUpperCase(), left, 40);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(report.title, left, 54);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  let y = 80;
  for (const line of report.meta) {
    doc.text(line, left, y, { width: usable });
    y += 13;
  }
  y += 8;

  const drawHeader = () => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
    report.columns.forEach((c, i) =>
      doc.text(c.header.toUpperCase(), xs[i]! + pad, y, {
        width: widths[i]! - pad * 2,
        align: c.align ?? 'left',
      }),
    );
    y += 14;
    doc
      .moveTo(left, y - 3)
      .lineTo(left + usable, y - 3)
      .strokeColor(INK)
      .lineWidth(0.8)
      .stroke();
  };
  drawHeader();

  doc.font('Helvetica').fontSize(8.5).fillColor(INK);
  if (report.rows.length === 0) {
    doc.fillColor(MUTED).text('Nothing in this period.', left + pad, y + 4);
    y += 20;
  }
  for (const row of report.rows) {
    const heights = row.map((cell, i) =>
      doc.heightOfString(cell || ' ', { width: widths[i]! - pad * 2 }),
    );
    const h = Math.max(...heights) + 6;
    if (y + h > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
      doc.font('Helvetica').fontSize(8.5).fillColor(INK);
    }
    row.forEach((cell, i) =>
      doc.text(cell, xs[i]! + pad, y + 3, {
        width: widths[i]! - pad * 2,
        align: report.columns[i]!.align ?? 'left',
      }),
    );
    y += h;
    doc
      .moveTo(left, y)
      .lineTo(left + usable, y)
      .strokeColor(LINE)
      .lineWidth(0.4)
      .stroke();
  }

  if (report.footnote) {
    if (y + 20 > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc
      .fillColor(MUTED)
      .fontSize(8)
      .text(report.footnote, left, y + 8, { width: usable });
  }

  // Page numbers and the print time on every page.
  const printed = new Date().toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would make pdfkit start a new page; lift it while we do.
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
    const footY = doc.page.height - margin - 2;
    doc.text(`${report.title} · printed ${printed}`, left, footY, {
      width: usable / 2,
      lineBreak: false,
    });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, left + usable / 2, footY, {
      width: usable / 2,
      align: 'right',
      lineBreak: false,
    });
    doc.page.margins.bottom = margin;
  }

  doc.end();
}
