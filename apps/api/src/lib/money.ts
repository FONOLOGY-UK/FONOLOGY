/** Integer pence → "£12.34" for user-facing sentences. The sign goes before the £ ("-£5.00"), not inside it. */
export function formatPence(pence: number): string {
  const body = `£${(Math.abs(pence) / 100).toFixed(2)}`;
  return pence < 0 ? `-${body}` : body;
}
