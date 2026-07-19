'use client';

import { useEffect, useRef } from 'react';
import { gsap } from '@/lib/gsap';
import { useEnvironment } from './use-environment';

/**
 * Magnetic pull on hover — port of core.js `magnetize`. Returns a ref to spread
 * on the target element (button/link). No-op on touch / reduced-motion.
 */
export function useMagnetic<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const { reduced, touch, ready } = useEnvironment();

  useEffect(() => {
    if (!ready || reduced || touch) return;
    const el = ref.current;
    if (!el) return;

    const xTo = gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power3.out' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power3.out' });

    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - r.left - r.width / 2) * 0.32);
      yTo((e.clientY - r.top - r.height / 2) * 0.32);
    };
    const onLeave = () => {
      xTo(0);
      yTo(0);
    };

    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, [ready, reduced, touch]);

  return ref;
}
