'use client';

import Lenis from 'lenis';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { gsap, registerGsap, ScrollTrigger } from '@/lib/gsap';
import { useEnvironment } from '@/lib/hooks/use-environment';

interface SmoothScrollApi {
  scrollTo: (target: number | string | HTMLElement, opts?: { offset?: number }) => void;
  stop: () => void;
  start: () => void;
}

const SmoothScrollContext = createContext<SmoothScrollApi>({
  scrollTo: () => {},
  stop: () => {},
  start: () => {},
});

export const useSmoothScroll = () => useContext(SmoothScrollContext);

/**
 * Lenis smooth scroll wired to GSAP's ticker and ScrollTrigger — a faithful
 * port of core.js. Disabled under prefers-reduced-motion (native scroll).
 */
export function SmoothScrollProvider({ children }: { children: ReactNode }) {
  const { reduced, ready } = useEnvironment();
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    registerGsap();
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!ready || reduced) return;
    const lenis = new Lenis({ lerp: 0.1, duration: 1.15, smoothWheel: true });
    lenisRef.current = lenis;

    const onScroll = () => ScrollTrigger.update();
    lenis.on('scroll', onScroll);

    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    return () => {
      lenis.off('scroll', onScroll);
      gsap.ticker.remove(raf);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [ready, reduced]);

  const api: SmoothScrollApi = {
    scrollTo: (target, opts) => {
      const lenis = lenisRef.current;
      if (lenis) {
        lenis.scrollTo(target, { offset: opts?.offset ?? 0, duration: 1.1 });
      } else {
        const y =
          typeof target === 'number'
            ? target
            : ((typeof target === 'string'
                ? document.querySelector(target)
                : target
              )?.getBoundingClientRect().top ?? 0);
        window.scrollTo({
          top: typeof target === 'number' ? y : y + window.scrollY + (opts?.offset ?? 0),
          behavior: reduced ? 'auto' : 'smooth',
        });
      }
    },
    stop: () => lenisRef.current?.stop(),
    start: () => lenisRef.current?.start(),
  };

  return <SmoothScrollContext.Provider value={api}>{children}</SmoothScrollContext.Provider>;
}
