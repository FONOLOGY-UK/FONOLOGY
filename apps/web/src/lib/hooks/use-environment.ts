'use client';

import { useEffect, useState } from 'react';

/**
 * Environment flags the storefront animation code branches on — mirrors
 * core.js: `reduced` (prefers-reduced-motion) and `touch` (coarse pointer).
 * SSR-safe: both start false and resolve after mount.
 */
export function useEnvironment() {
  const [env, setEnv] = useState({ reduced: false, touch: false, ready: false });

  useEffect(() => {
    const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const touchMq = window.matchMedia('(hover: none), (pointer: coarse)');
    const update = () =>
      setEnv({ reduced: reducedMq.matches, touch: touchMq.matches, ready: true });
    update();
    reducedMq.addEventListener('change', update);
    touchMq.addEventListener('change', update);
    return () => {
      reducedMq.removeEventListener('change', update);
      touchMq.removeEventListener('change', update);
    };
  }, []);

  return env;
}
