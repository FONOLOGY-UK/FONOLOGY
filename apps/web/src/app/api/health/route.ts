import { NextResponse } from 'next/server';

/**
 * Liveness probe for Docker / Coolify healthchecks. Infrastructure only — this
 * is NOT a data API (HARD RULE #2: business data flows through the DataAdapter).
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok', service: 'fonology-web', ts: Date.now() });
}
