/** Small date helpers shared by admin filters, prompts and reports. */

/** Local calendar day as "YYYY-MM-DD". */
export function isoDay(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local day `days` back from today, as "YYYY-MM-DD". */
export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return isoDay(d);
}

/** "Sat 19 Jul" style display for an ISO day or timestamp. */
export function formatDay(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** "19 Jul, 14:32" for timestamps in dense tables. */
export function formatDateTime(value: string): string {
  const d = new Date(value);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
