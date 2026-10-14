/**
 * The warranty line of a part grade is free text the admin edits ("12-month warranty",
 * "90-day warranty"). The homepage quotes the SHORTEST one ("minimum warranty"), so it has to
 * read the number back out of that text rather than keep its own copy.
 */

type Unit = 'day' | 'month' | 'year';
const DAYS: Record<Unit, number> = { day: 1, month: 30, year: 365 };

export interface Warranty {
  amount: number;
  unit: Unit;
}

export function parseWarranty(text: string): Warranty | null {
  const m = /(\d+)\s*[- ]?\s*(day|month|year)s?/i.exec(text);
  if (!m) return null;
  return { amount: Number(m[1]), unit: m[2]!.toLowerCase() as Unit };
}

/** The shortest warranty among the grades' texts, or null when none can be read. */
export function shortestWarranty(texts: string[]): Warranty | null {
  let best: Warranty | null = null;
  for (const text of texts) {
    const w = parseWarranty(text);
    if (!w) continue;
    if (!best || w.amount * DAYS[w.unit] < best.amount * DAYS[best.unit]) best = w;
  }
  return best;
}

/** "90-day", "6-month" — for the hero chip. */
export function warrantyLabel(w: Warranty): string {
  return `${w.amount}-${w.unit}`;
}
