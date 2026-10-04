'use client';

import { useEffect, useRef } from 'react';

/**
 * Scroll an element into view the moment it appears. Used for a form's submit error: on a tall wizard
 * step the message sits under the button, and a customer who clicked and sees nothing happen assumes
 * the button is broken (QA v5 #7 — the "Cannot book a repair while signed in as staff" refusal).
 */
export function useRevealWhen<T extends HTMLElement>(show: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (show) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [show]);
  return ref;
}
