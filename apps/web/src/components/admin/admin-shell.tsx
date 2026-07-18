'use client';

import type { ReactNode } from 'react';

/**
 * Admin dashboard app-shell wrapper (client-rendered, no SEO).
 *
 * PHASE 1 = STRUCTURE ONLY. This is a bare client shell so the (dashboard)
 * route group has a layout, per item 5 ("route group layouts and shells").
 * The actual dashboard — sidebar/nav IA, KPIs, tables, charts — is designed
 * and built in a later phase (prompts 8–12). Nothing is invented here.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  return <div className="bg-background text-foreground min-h-screen">{children}</div>;
}
