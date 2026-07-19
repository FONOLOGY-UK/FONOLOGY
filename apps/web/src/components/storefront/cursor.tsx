'use client';

import { useEffect, useRef } from 'react';
import { gsap } from '@/lib/gsap';
import { useEnvironment } from '@/lib/hooks/use-environment';

/**
 * Custom cursor (dot + trailing ring + contextual label) — faithful port of
 * core.js. Only active on fine-pointer, non-reduced-motion devices; adds the
 * `has-cursor` class that hides the native cursor via storefront.css.
 */
export function Cursor() {
  const { reduced, touch, ready } = useEnvironment();
  const rootRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!ready || reduced || touch) return;
    const root = rootRef.current;
    const dot = dotRef.current;
    const ring = ringRef.current;
    const label = labelRef.current;
    if (!root || !dot || !ring || !label) return;

    document.documentElement.classList.add('has-cursor');

    const dx = gsap.quickTo(dot, 'x', { duration: 0.12, ease: 'power3.out' });
    const dy = gsap.quickTo(dot, 'y', { duration: 0.12, ease: 'power3.out' });
    const rx = gsap.quickTo(ring, 'x', { duration: 0.45, ease: 'power3.out' });
    const ry = gsap.quickTo(ring, 'y', { duration: 0.45, ease: 'power3.out' });

    const onMove = (e: MouseEvent) => {
      dx(e.clientX);
      dy(e.clientY);
      rx(e.clientX);
      ry(e.clientY);
    };
    const onDown = () => root.classList.add('is-down');
    const onUp = () => root.classList.remove('is-down');
    const onOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const labelled = target.closest<HTMLElement>('[data-cursor-label]');
      const hot = target.closest('a, button, [data-cursor], input, textarea, select, .rail__item');
      if (labelled) {
        label.textContent = labelled.dataset.cursorLabel ?? '';
        root.classList.add('is-label');
        root.classList.remove('is-hover');
      } else if (hot) {
        root.classList.add('is-hover');
        root.classList.remove('is-label');
      } else {
        root.classList.remove('is-hover', 'is-label');
      }
    };
    const onLeave = () => gsap.to(root, { autoAlpha: 0, duration: 0.25 });
    const onEnter = () => gsap.to(root, { autoAlpha: 1, duration: 0.25 });

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseleave', onLeave);
    document.addEventListener('mouseenter', onEnter);

    return () => {
      document.documentElement.classList.remove('has-cursor');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('mouseenter', onEnter);
    };
  }, [ready, reduced, touch]);

  return (
    <div className="cursor" ref={rootRef} aria-hidden="true">
      <div className="cursor__dot" ref={dotRef} />
      <div className="cursor__ring" ref={ringRef}>
        <span className="cursor__label" ref={labelRef} />
      </div>
    </div>
  );
}
