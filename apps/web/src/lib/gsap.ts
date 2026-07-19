'use client';

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * Central GSAP setup. ScrollTrigger is registered once, client-side only.
 * GSAP/ScrollTrigger are dynamically pulled into the client bundle by the
 * components that use them (code-split away from the initial server payload).
 */
let registered = false;
export function registerGsap(): void {
  if (registered || typeof window === 'undefined') return;
  gsap.registerPlugin(ScrollTrigger);
  registered = true;
}

/** The prototype's easing vocabulary (core.js EASE). */
export const EASE = {
  out: 'power3.out',
  expo: 'expo.out',
  inOut: 'power4.inOut',
  soft: 'power2.out',
} as const;

export { gsap, ScrollTrigger };
