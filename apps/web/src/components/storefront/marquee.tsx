'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { gsap } from '@/lib/gsap';
import { useEnvironment } from '@/lib/hooks/use-environment';

/**
 * Infinite marquee ticker — port of core.js marquee: duplicates the track to
 * fill 2× viewport, translates -50% on a loop, slows to 0.25× on hover. Under
 * reduced motion the track is static (content still visible).
 */
export function Marquee({
  items,
  speed = 70,
  variant,
  className,
}: {
  items: ReactNode[];
  /** px per second */
  speed?: number;
  variant?: 'ink';
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const { reduced, ready } = useEnvironment();

  useEffect(() => {
    if (!ready || reduced) return;
    const wrap = wrapRef.current;
    const track = trackRef.current;
    if (!wrap || !track) return;

    const tween = gsap.to(track, {
      xPercent: -50,
      ease: 'none',
      repeat: -1,
      duration: track.scrollWidth / 2 / speed,
    });
    const slow = () => gsap.to(tween, { timeScale: 0.25, duration: 0.5 });
    const fast = () => gsap.to(tween, { timeScale: 1, duration: 0.5 });
    wrap.addEventListener('mouseenter', slow);
    wrap.addEventListener('mouseleave', fast);
    return () => {
      wrap.removeEventListener('mouseenter', slow);
      wrap.removeEventListener('mouseleave', fast);
      tween.kill();
      gsap.set(track, { clearProps: 'all' });
    };
  }, [ready, reduced, speed]);

  // Two copies so the -50% loop is seamless (matches the prototype's repeat).
  // item + sep are siblings, exactly as the prototype markup.
  const copy = (keyPrefix: string, hidden: boolean) =>
    items.map((item, i) => (
      <span key={`${keyPrefix}-${i}`} className="contents" aria-hidden={hidden || undefined}>
        <span className="marquee__item">{item}</span>
        {/*
          Empty on purpose — the separator is DRAWN in CSS, not typed.
          It used to be the character U+2733 (‘✳’), which most desktop
          browsers render as a plain glyph and most phones substitute with a
          full-colour emoji from the system font. Same markup, different
          character, and on mobile it landed as a coloured sparkle in the
          middle of a red brand marquee. A shape we draw ourselves cannot be
          re-interpreted by anyone’s font stack.
        */}
        <span className="marquee__sep" aria-hidden="true" />
      </span>
    ));

  const content = (
    <>
      {copy('a', false)}
      {copy('b', true)}
    </>
  );

  return (
    <div
      className={['marquee', variant === 'ink' ? 'marquee--ink' : '', className]
        .filter(Boolean)
        .join(' ')}
      ref={wrapRef}
    >
      <div className="marquee__track" ref={trackRef}>
        {content}
      </div>
    </div>
  );
}
