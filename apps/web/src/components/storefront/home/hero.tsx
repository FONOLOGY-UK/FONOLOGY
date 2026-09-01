'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { EASE, gsap, registerGsap } from '@/lib/gsap';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { useMagnetic } from '@/lib/hooks/use-magnetic';
import { Marquee } from '@/components/storefront/marquee';

/** Hero phone — verbatim SVG from the prototype (index.html), injected as-is. */
const PHONE_SVG = `
<svg class="hero__phone" viewBox="0 0 320 640" fill="none">
  <defs>
    <linearGradient id="scrGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2E2E33"/><stop offset=".55" stop-color="#17171A"/><stop offset="1" stop-color="#232327"/>
    </linearGradient>
    <linearGradient id="shineGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity=".14"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="10" y="10" width="300" height="620" rx="52" fill="#1A1A1C" stroke="#3C3C42" stroke-width="3"/>
  <rect x="22" y="22" width="276" height="596" rx="42" fill="url(#scrGrad)"/>
  <rect x="22" y="22" width="276" height="596" rx="42" fill="url(#shineGrad)"/>
  <rect x="118" y="34" width="84" height="26" rx="13" fill="#050506" stroke="#4A4A52" stroke-width="1.5"/>
  <circle cx="188" cy="47" r="5" fill="#2E2E33"/>
  <text x="160" y="205" text-anchor="middle" class="hp-time">16:42</text>
  <text x="160" y="238" text-anchor="middle" class="hp-date">Thu 10 July</text>
  <g class="hp-spark"><path d="M160 300 L166 324 L190 330 L166 336 L160 360 L154 336 L130 330 L154 324 Z" fill="#E8250C"/></g>
  <text x="160" y="410" text-anchor="middle" class="hp-brand">FONOLOGY</text>
  <text x="160" y="438" text-anchor="middle" class="hp-note">repair in progress…</text>
  <rect x="118" y="588" width="84" height="5" rx="2.5" fill="#4A4A52"/>
  <g class="hp-cracks" stroke="#FFB9A6" stroke-width="2" stroke-linecap="round" fill="none" opacity=".9">
    <path class="hp-crack" d="M298 40 L236 118 L252 168 L214 214"/>
    <path class="hp-crack" d="M236 118 L188 132"/>
    <path class="hp-crack" d="M252 168 L292 196"/>
    <path class="hp-crack" d="M214 214 L232 262 L210 300"/>
  </g>
</svg>`;

const MARQUEE_ITEMS = [
  'Screens',
  'Batteries',
  'Charging ports',
  'Water damage',
  'Data recovery',
  'Same-day',
];

export function Hero() {
  const { reduced, touch, ready } = useEnvironment();
  const rootRef = useRef<HTMLElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);
  const bookRef = useMagnetic<HTMLAnchorElement>();
  const shopRef = useMagnetic<HTMLAnchorElement>();

  useEffect(() => {
    if (!ready) return;
    registerGsap();

    /**
     * Guarantees the hero ends up visible even if the intro never plays.
     *
     * THE BUG THIS EXISTS FOR
     * Every reveal below is a gsap `.from()` with `autoAlpha: 0`, which means
     * GSAP writes `opacity: 0; visibility: hidden` onto the element the moment
     * the tween is created and only takes it off again as the tween plays. So
     * the eyebrow, the sub-heading, the phone visual and BOTH primary calls to
     * action exist in a hidden state first and become visible second. If
     * anything stops the timeline finishing, they stay hidden permanently.
     *
     * Things that stop it finishing, all of them real:
     *   - the page loads in a BACKGROUND TAB. GSAP is driven by
     *     requestAnimationFrame, and a browser does not fire rAF for a tab that
     *     is not being composited. The timeline is created, writes its from-
     *     state, and then never advances a single frame. Opening the site with
     *     ctrl-click or "open in new tab" is enough. (Observed directly:
     *     document.hidden true, zero rAF callbacks in a second, hero stuck.)
     *   - the timeline is interrupted or killed part-way.
     *
     * The symptom is nasty because it half-hides: a button left at
     * `translate(0, 26px)` looks CLIPPED rather than missing, and hovering it
     * fires the magnetic hook, which overwrites the transform and snaps the
     * button into place — so it "comes up on hover and then stays right", and
     * looks like a hover bug rather than an intro that never ran.
     *
     * A timer rather than a visibilitychange listener, because setTimeout keeps
     * firing in a hidden tab (throttled, but it fires) and this needs to hold
     * for every cause, not just the one that is easy to name. Well past the
     * ~2s the timeline actually takes, so a normal load never reaches it.
     */
    let heroTl: gsap.core.Timeline | null = null;
    let loaderTl: gsap.core.Timeline | null = null;

    /**
     * The hero's resting state, written down in one place.
     *
     * This is the actual fix for "the buttons render clipped and snap into
     * place the first time you touch them". Nothing ever DEFINED where the
     * CTAs sit at rest: they arrived there only as a side effect of the intro
     * tween finishing, and the first pointer event was the next thing to write
     * a transform (useMagnetic drives x/y to 0 on mouseleave) — which is why
     * hovering "fixed" them and why it looked like a hover bug. Any path where
     * the intro did not finish left `translate(0, 26px)` on screen for good.
     */
    const restCtas = () => {
      gsap.set('#heroCtas > *', { x: 0, y: 0, autoAlpha: 1 });
    };

    const heroEnter = () => {
      if (reduced) {
        restCtas();
        return;
      }
      const tl = gsap.timeline({ defaults: { ease: EASE.expo }, onComplete: restCtas });
      heroTl = tl;
      tl.from('#nav > *', { y: -20, autoAlpha: 0, stagger: 0.07, duration: 0.7 }, 0)
        .from('[data-hero-line]', { yPercent: 132, duration: 1.15, stagger: 0.12 }, 0.05)
        .from('#heroEyebrow', { y: 24, autoAlpha: 0, duration: 0.7 }, 0.4)
        .from('#heroSub', { y: 26, autoAlpha: 0, duration: 0.8 }, 0.65)
        .from('#heroCtas > *', { y: 26, autoAlpha: 0, stagger: 0.08, duration: 0.7 }, 0.75)
        .from('#heroVisual', { y: 90, autoAlpha: 0, duration: 1.2, ease: EASE.expo }, 0.5)
        .from(
          '.hero__chip',
          { scale: 0.5, autoAlpha: 0, stagger: 0.1, duration: 0.7, ease: 'back.out(1.8)' },
          1,
        )
        .from('.hero__marquee', { yPercent: 100, duration: 0.8 }, 0.9);
    };

    const killLoader = () => {
      const loader = loaderRef.current;
      if (loader) {
        loader.classList.add('is-done');
        loader.style.display = 'none';
      }
    };

    /**
     * WHY THIS TIMER IS ARMED HERE AND NOT INSIDE heroEnter
     * It used to be created inside heroEnter, which meant it only ever existed
     * on the path where heroEnter had already been called. On a FIRST visit
     * heroEnter is not called directly — it is appended to the tail of the
     * loader timeline. So if the loader timeline never advanced, heroEnter
     * never ran, and the failsafe that exists to rescue exactly that situation
     * was never armed. Confirmed on the deployed site: loading the home page
     * in a background tab leaves the loader element without its `is-done`
     * class and the hero intro never starts, because a browser fires no
     * requestAnimationFrame for a tab it is not compositing and GSAP is driven
     * by rAF. setTimeout keeps firing in a hidden tab (throttled, but it
     * fires), which is why it is a timer and not a visibilitychange listener.
     *
     * `settle` is written to be safe from any state: mid-loader, mid-hero,
     * or before either has started.
     */
    const settle = () => {
      killLoader();
      if (loaderTl && loaderTl.progress() < 1) loaderTl.progress(1);
      if (!heroTl) heroEnter();
      if (heroTl && heroTl.progress() < 1) heroTl.progress(1);
      restCtas();
    };
    const failsafe = window.setTimeout(settle, 4000);

    const ctx = gsap.context(() => {
      // 1 · LOADER → HERO
      const loader = loaderRef.current;
      const seen = sessionStorage.getItem('fnl-seen');
      if (!loader || reduced || seen) {
        killLoader();
        heroEnter();
      } else {
        loader.style.animation = 'none';
        sessionStorage.setItem('fnl-seen', '1');
        const letters = gsap.utils.toArray<HTMLElement>('#loaderWord span');
        const count = loader.querySelector<HTMLElement>('#loaderCount');
        const obj = { v: 0 };
        loaderTl = gsap
          .timeline({ onComplete: killLoader })
          .fromTo(
            letters,
            { yPercent: 120 },
            { yPercent: 0, duration: 0.9, stagger: 0.055, ease: EASE.expo },
            0.1,
          )
          .from('.loader__meta', { autoAlpha: 0, y: 14, duration: 0.5 }, 0.5)
          .to(
            obj,
            {
              v: 100,
              duration: 1.5,
              ease: 'power2.inOut',
              onUpdate: () => {
                if (count) count.textContent = String(Math.round(obj.v)).padStart(2, '0');
              },
            },
            0.35,
          )
          .to('.loader__panel', { scaleY: 1, duration: 0.55, ease: EASE.inOut }, '-=0.25')
          .to(letters, { yPercent: -120, duration: 0.55, stagger: 0.04, ease: 'power3.in' }, '<')
          .to('.loader__meta', { autoAlpha: 0, duration: 0.3 }, '<')
          .to(loader, { yPercent: -100, duration: 0.75, ease: EASE.inOut }, '-=0.1')
          .add(heroEnter, '-=0.55');
      }

      // 2 · HERO ambient — crack cycle, float, parallax
      const cracks = gsap.utils.toArray<SVGPathElement>('.hp-crack');
      if (!reduced && cracks.length) {
        cracks.forEach((p) => {
          const len = p.getTotalLength();
          gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
        });
        gsap
          .timeline({ repeat: -1, repeatDelay: 1.6, delay: 2.2 })
          .to(cracks, { strokeDashoffset: 0, duration: 0.9, stagger: 0.18, ease: 'power2.out' })
          .to({}, { duration: 1.4 })
          .to(cracks, { opacity: 0, duration: 0.7, ease: 'power2.inOut' }, '>')
          .to(
            '.hero__glow',
            { scale: 1.25, opacity: 1.6, duration: 0.7, yoyo: true, repeat: 1, ease: 'sine.inOut' },
            '<',
          )
          .set(cracks, {
            strokeDashoffset: (_i: number, target: Element) =>
              (target as SVGPathElement).getTotalLength(),
            opacity: 0.9,
          });
      }

      if (!reduced) {
        gsap.to('#heroPhoneWrap', {
          y: -14,
          rotate: 6.4,
          duration: 5.4,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut',
        });
        gsap.utils.toArray<HTMLElement>('.hero__chip').forEach((chip, i) => {
          gsap.to(chip, {
            y: i % 2 ? 12 : -12,
            duration: 4.4 + i,
            yoyo: true,
            repeat: -1,
            ease: 'sine.inOut',
          });
        });
        gsap.to('#heroVisual', {
          yPercent: 16,
          ease: 'none',
          scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true },
        });
        if (!touch) {
          const onMove = (e: MouseEvent) => {
            const nx = e.clientX / window.innerWidth - 0.5;
            gsap.to('#heroPhoneWrap', {
              x: nx * 22,
              rotationY: nx * 4,
              duration: 1,
              ease: 'power2.out',
              overwrite: 'auto',
            });
            gsap.utils.toArray<HTMLElement>('.hero__chip').forEach((chip) => {
              const d = parseFloat(chip.dataset.depth || '0.06') * 500;
              gsap.to(chip, { x: nx * d, duration: 1.2, ease: 'power2.out', overwrite: 'auto' });
            });
          };
          window.addEventListener('mousemove', onMove);
          return () => window.removeEventListener('mousemove', onMove);
        }
      }
    }, rootRef);

    return () => {
      window.clearTimeout(failsafe);
      ctx.revert();
    };
  }, [ready, reduced, touch]);

  return (
    <section className="hero" id="hero" ref={rootRef}>
      {/* Loader — home-only, first-visit choreography */}
      <div className="loader" id="loader" ref={loaderRef} aria-hidden="true">
        <div className="loader__word" id="loaderWord">
          {'FONOLOGY'.split('').map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
        <div className="loader__meta">
          <span className="loader__tag">PHONE SURGERY — UK HIGH STREET</span>
          <span className="loader__count" id="loaderCount">
            00
          </span>
        </div>
        <div className="loader__panel" />
      </div>

      <div className="hero__inner container">
        <p className="hero__eyebrow eyebrow" id="heroEyebrow">
          Phone repair &amp; accessories — UK high street
        </p>

        <h1 className="hero__title" aria-label="Cracked. Fixed. Same day.">
          <span className="h-mask">
            <span className="h-line" data-hero-line>
              CRACKED<span className="h-dot">.</span>
            </span>
          </span>
          <span className="h-mask h-mask--serif">
            <span className="h-line h-line--serif" data-hero-line>
              <em>fixed.</em>
            </span>
          </span>
          <span className="h-mask">
            <span className="h-line" data-hero-line>
              SAME&nbsp;DAY<span className="h-dot">.</span>
            </span>
          </span>
        </h1>

        <div className="hero__foot">
          <p className="hero__sub" id="heroSub">
            Fonology is the repair counter your phone hopes it ends up on. Screens, batteries and
            charging ports — priced before we touch a screw, fixed while you get a coffee,
            warrantied in writing.
          </p>
          <div className="hero__ctas" id="heroCtas">
            <Link href="/repair" className="btn btn--ink" ref={bookRef}>
              <span className="btn__label">Start a repair</span>
              <span className="btn__arrow" aria-hidden="true">
                →
              </span>
            </Link>
            <Link href="/shop" className="btn btn--ghost" ref={shopRef}>
              <span className="btn__label">Shop accessories</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="hero__visual" id="heroVisual" aria-hidden="true">
        <div className="hero__glow" />
        <div
          className="hero__phone-wrap"
          id="heroPhoneWrap"
          dangerouslySetInnerHTML={{ __html: PHONE_SVG }}
        />
        <div className="hero__chip hero__chip--1" data-depth="0.05">
          <strong>38 min</strong>
          <span>average screen fix</span>
        </div>
        <div className="hero__chip hero__chip--2" data-depth="0.09">
          <strong>4.9 ★</strong>
          <span>900+ local reviews</span>
        </div>
        <div className="hero__chip hero__chip--3" data-depth="0.14">
          <strong>90-day</strong>
          <span>minimum warranty</span>
        </div>
      </div>

      <Marquee items={MARQUEE_ITEMS} speed={70} className="hero__marquee" />
    </section>
  );
}
