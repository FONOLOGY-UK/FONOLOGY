'use client';

import type { ReactNode } from 'react';

/**
 * Employee POS app-shell wrapper (client-rendered, no SEO).
 *
 * PHASE 1 = STRUCTURE ONLY. Bare client shell so the (pos) route group has a
 * layout, per item 5 ("route group layouts and shells"). The actual in-store
 * counter panel is designed and built in a later phase (prompts 8–12).
 */
export function PosShell({ children }: { children: ReactNode }) {
  return <div className="bg-background text-foreground min-h-screen">{children}</div>;
}
