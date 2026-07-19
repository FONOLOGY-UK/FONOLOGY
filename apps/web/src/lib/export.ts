/**
 * Client-side CSV export for admin reports. Real download, no backend —
 * "Excel" buttons produce a .csv Excel opens directly. PDF export stays a
 * print-dialog flow (the browser's Save as PDF) until Raja wires server-side
 * rendering. See NOTES.md.
 */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (value: string | number) => {
    const s = `${value}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
