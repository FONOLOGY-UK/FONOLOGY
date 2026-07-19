'use client';

import { createElement, useEffect, useRef, type ElementType, type ReactNode } from 'react';
import { EASE, gsap, registerGsap } from '@/lib/gsap';
import { useEnvironment } from '@/lib/hooks/use-environment';

/**
 * Scroll-reveal — port of core.js `initReveals` [data-reveal]: fade + rise once
 * on scroll-in. Content is fully visible without JS / under reduced motion.
 */
export function Reveal({
  as = 'div',
  className,
  children,
  ...rest
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);
  const { reduced, ready } = useEnvironment();

  useEffect(() => {
    if (!ready || reduced || !ref.current) return;
    registerGsap();
    const el = ref.current;
    const tween = gsap.from(el, {
      y: 46,
      autoAlpha: 0,
      duration: 1,
      ease: EASE.out,
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
      gsap.set(el, { clearProps: 'all' });
    };
  }, [ready, reduced]);

  return createElement(as, { ref, className, ...rest }, children);
}

/**
 * Heading with masked line-by-line rise — port of core.js `[data-lines]`.
 * Pass each line as an item; markup matches the prototype's `.h-mask > .line`.
 */
export function LineMaskHeading({
  as = 'h2',
  className,
  lines,
  start = 'top 86%',
  immediate = false,
}: {
  as?: ElementType;
  className?: string;
  lines: ReactNode[];
  start?: string;
  /** Animate on mount instead of on scroll — for page hero titles at the top. */
  immediate?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const { reduced, ready } = useEnvironment();

  useEffect(() => {
    if (!ready || reduced || !ref.current) return;
    registerGsap();
    const el = ref.current;
    const lineEls = el.querySelectorAll<HTMLElement>('.line');
    const tween = gsap.from(lineEls, {
      yPercent: 132,
      duration: 1.1,
      stagger: 0.09,
      ease: EASE.expo,
      ...(immediate ? {} : { scrollTrigger: { trigger: el, start, once: true } }),
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
      gsap.set(lineEls, { clearProps: 'all' });
    };
  }, [ready, reduced, start, immediate]);

  return createElement(
    as,
    { ref, className },
    lines.map((line, i) =>
      createElement(
        'span',
        { className: 'h-mask', key: i },
        createElement('span', { className: 'line' }, line),
      ),
    ),
  );
}
