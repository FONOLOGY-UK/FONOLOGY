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

    /**
     * TWO THINGS USED TO OWN `transform` ON THIS ELEMENT.
     *
     * `.btn` carries `transition: transform 0.2s` in CSS, and this hook drives
     * transform from JS every frame. A CSS transition on a property GSAP is
     * animating means the browser re-interpolates every single write, so the
     * element permanently trails the value it was told to be — the magnetic
     * pull lags, and the intro tween's final frame is fought rather than
     * honoured. Whichever wrote last won, which is what made the resting
     * position look arbitrary.
     *
     * The class hands transform to GSAP alone while the hook is live, and CSS
     * keeps colour and border, which nothing else touches. Removed on cleanup
     * so an element that stops being magnetic (reduced motion switched on, a
     * touch device rotating into a hover-capable mode) gets its CSS back.
     */
    el.classList.add('is-magnetic');

    // The resting transform, stated rather than assumed. gsap.quickTo caches
    // the property it drives, so it needs a defined starting value; without
    // this its first invocation is also the first thing to write x/y at all.
    gsap.set(el, { x: 0, y: 0 });

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
      el.classList.remove('is-magnetic');
    };
  }, [ready, reduced, touch]);

  return ref;
}
