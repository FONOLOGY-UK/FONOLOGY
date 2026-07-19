'use client';

import { gsap } from '@/lib/gsap';

/**
 * "Add to bag" flying dot — port of core.js `flyToCart`. Launches a small red
 * dot from the source element to the nav cart button (`#cartBtn`).
 */
export function flyToCart(fromEl: HTMLElement): void {
  const cartBtn = document.getElementById('cartBtn');
  if (!cartBtn) return;
  const a = fromEl.getBoundingClientRect();
  const b = cartBtn.getBoundingClientRect();
  const dot = document.createElement('span');
  Object.assign(dot.style, {
    position: 'fixed',
    zIndex: '3500',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    background: 'var(--red)',
    pointerEvents: 'none',
    left: `${a.left + a.width / 2}px`,
    top: `${a.top + a.height / 2}px`,
  });
  document.body.appendChild(dot);
  gsap
    .timeline({ onComplete: () => dot.remove() })
    .to(dot, {
      x: b.left + b.width / 2 - (a.left + a.width / 2),
      y: b.top + b.height / 2 - (a.top + a.height / 2),
      duration: 0.7,
      ease: 'power2.inOut',
    })
    .to(dot, { scale: 0, duration: 0.2 }, '-=0.12');
}
