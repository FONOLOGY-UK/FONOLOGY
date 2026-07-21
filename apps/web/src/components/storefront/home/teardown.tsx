'use client';

import { Fragment, useEffect, useRef } from 'react';
import { EASE, gsap, registerGsap } from '@/lib/gsap';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { Reveal, LineMaskHeading } from '@/components/storefront/reveal';
import { Spark } from '@/components/storefront/art';

/** Teardown phone with separable layers — verbatim SVG from the prototype. */
const TEARDOWN_SVG = `
<svg class="teardown__phone" id="tdPhone" viewBox="0 0 380 720" fill="none">
  <g class="td-layer" id="tdFrame">
    <rect x="65" y="110" width="250" height="520" rx="50" fill="#FBFAF7" stroke="#181010" stroke-width="3"/>
    <rect x="88" y="134" width="86" height="86" rx="24" fill="none" stroke="#181010" stroke-width="2.5"/>
    <circle cx="113" cy="159" r="12" fill="none" stroke="#181010" stroke-width="2.5"/>
    <circle cx="149" cy="195" r="12" fill="none" stroke="#181010" stroke-width="2.5"/>
    <circle cx="152" cy="158" r="4" fill="#E8250C"/>
    <text x="190" y="594" text-anchor="middle" class="td-etch">FONOLOGY · REBUILT</text>
  </g>
  <g class="td-layer" id="tdBoard">
    <rect x="98" y="142" width="184" height="456" rx="16" fill="#F1EDE6" stroke="#181010" stroke-width="2.5"/>
    <path d="M124 186 h64 v42 h-36 v54 h62 M146 330 h88 M146 362 h56 v62 h46 M130 470 h104 v52 h-62" stroke="#181010" stroke-opacity=".4" stroke-width="2.5" fill="none"/>
    <rect x="158" y="216" width="58" height="58" rx="6" fill="#E8250C"/>
    <rect x="132" y="392" width="36" height="36" rx="5" fill="#31221F"/>
    <rect x="204" y="432" width="48" height="27" rx="5" fill="#31221F"/>
    <circle cx="238" cy="196" r="7" fill="#181010" opacity=".45"/>
    <circle cx="130" cy="540" r="7" fill="#181010" opacity=".45"/>
  </g>
  <g class="td-layer" id="tdBattery">
    <rect x="108" y="192" width="164" height="336" rx="20" fill="#FFFFFF" stroke="#181010" stroke-width="2.5"/>
    <path d="M190 296 l-22 44 h22 l-22 44" stroke="#E8250C" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <text x="190" y="478" text-anchor="middle" class="td-etch">3,349 mAh · NEW CELL</text>
  </g>
  <g class="td-layer" id="tdScreen">
    <rect x="82" y="126" width="216" height="488" rx="34" fill="#1C1B1A" stroke="#181010" stroke-width="2.5"/>
    <rect x="156" y="146" width="68" height="20" rx="10" fill="#504B47"/>
    <path d="M190 322 L196 346 L220 352 L196 358 L190 382 L184 358 L160 352 L184 346 Z" fill="#E8250C"/>
    <text x="190" y="430" text-anchor="middle" class="td-etch td-etch--onink">OLED · GRADE: YOUR CALL</text>
  </g>
  <g class="td-layer" id="tdGlass">
    <rect x="76" y="120" width="228" height="500" rx="38" fill="rgba(24,16,16,.03)" stroke="#181010" stroke-width="2.5"/>
    <rect x="153" y="140" width="74" height="22" rx="11" fill="none" stroke="#181010" stroke-width="2.5"/>
    <path d="M116 176 L258 556" stroke="#181010" stroke-opacity=".14" stroke-width="2"/>
    <path d="M100 300 L224 620" stroke="#181010" stroke-opacity=".08" stroke-width="2"/>
    <g class="td-crack" id="tdCrack" stroke="#E8250C" stroke-width="2" stroke-linecap="round" fill="none" opacity=".8">
      <path d="M282 146 L226 238 L242 298 L206 354"/>
      <path d="M226 238 L186 256"/>
    </g>
  </g>
</svg>`;

const STEPS = [
  {
    no: '01',
    title: 'Diagnose',
    body: 'Free bench check. We tell you what’s actually wrong — in plain English, with a fixed price.',
  },
  {
    no: '02',
    title: 'Open',
    body: 'Heat, picks and patience. No pry-bar shortcuts, no stripped screws, no broken clips.',
  },
  {
    no: '03',
    title: 'Replace',
    body: 'You choose the part grade — Original, OEM or Copy. We fit it the way the factory did.',
  },
  {
    no: '04',
    title: 'Test',
    body: '48-point check — touch, cameras, mics, Face ID, charging. Then it goes home with you.',
  },
];

const LABELS = [
  'Front glass — replaced in-house',
  'OLED display — three part grades',
  'Battery — fresh genuine cells',
  'Logic board — micro-soldering bench',
  'Chassis — realigned & resealed',
];

export function Teardown() {
  const { reduced, ready } = useEnvironment();
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!ready) return;
    registerGsap();
    const root = rootRef.current;
    if (!root) return;

    const setStep = (i: number) =>
      root.querySelectorAll('.td-step').forEach((s, k) => s.classList.toggle('is-active', k === i));

    const mm = gsap.matchMedia();

    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      const EXP = { glass: -175, screen: -88, battery: 4, board: 96, frame: 188 };
      gsap.set('#tdWarranty', { autoAlpha: 0, y: 20 });
      const tdLabels = gsap.utils.toArray<HTMLElement>('.td-label');
      const crack = root.querySelector('#tdCrack');

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: '#teardownPin',
          start: 'top top',
          end: '+=340%',
          pin: true,
          scrub: 1,
          anticipatePin: 1,
          onUpdate: (self) => {
            gsap.set('#tdBar', { scaleX: self.progress });
            setStep(Math.min(3, Math.floor(self.progress * 4)));
          },
        },
        defaults: { ease: 'power2.inOut' },
      });

      tl.fromTo('#tdPhone', { rotate: 0, scale: 1 }, { rotate: -3, scale: 1.02, duration: 0.7 }, 0)
        .to('#tdGlass', { y: EXP.glass, duration: 1 }, 0.9)
        .to('#tdScreen', { y: EXP.screen, duration: 1 }, 0.95)
        .to('#tdBattery', { y: EXP.battery, duration: 1 }, 1)
        .to('#tdBoard', { y: EXP.board, duration: 1 }, 1.05)
        .to('#tdFrame', { y: EXP.frame, duration: 1 }, 1.1)
        .to('#tdPhone', { rotate: 0, scale: 0.84, duration: 1 }, 0.9);

      tdLabels.forEach((lb, i) => {
        const t = 1.25 + i * 0.16;
        tl.to(lb, { autoAlpha: 1, duration: 0.3 }, t).to(
          lb.querySelector('i'),
          { scaleX: 1, duration: 0.35 },
          t,
        );
      });

      tl.to(crack, { opacity: 0, duration: 0.5 }, 2.3).fromTo(
        '#tdScreen path',
        { fill: '#E8250C' },
        { fill: '#FF5A2E', duration: 0.4, yoyo: true, repeat: 1 },
        2.3,
      );

      tl.to(tdLabels, { autoAlpha: 0, duration: 0.35 }, 3.0)
        .to(
          tdLabels.map((l) => l.querySelector('i')),
          { scaleX: 0, duration: 0.3 },
          3.0,
        )
        .to(
          ['#tdGlass', '#tdScreen', '#tdBattery', '#tdBoard', '#tdFrame'],
          { y: 0, duration: 0.9, ease: EASE.inOut },
          3.15,
        )
        .to('#tdPhone', { scale: 1, rotate: 0, duration: 0.9 }, 3.15)
        .to('#tdWarranty', { autoAlpha: 1, y: 0, duration: 0.4 }, 3.7);

      return () => setStep(0);
    });

    mm.add('(max-width: 1023px)', () => {
      gsap.set('#tdGlass', { y: -84 });
      gsap.set('#tdScreen', { y: -42 });
      gsap.set('#tdBattery', { y: 2 });
      gsap.set('#tdBoard', { y: 46 });
      gsap.set('#tdFrame', { y: 90 });
      gsap.set('#tdPhone', { scale: 0.94 });
    });

    return () => mm.revert();
  }, [ready, reduced]);

  return (
    <section className="teardown" id="teardown" ref={rootRef}>
      <div className="teardown__pin" id="teardownPin">
        <div className="teardown__progress" aria-hidden="true">
          <div className="teardown__bar" id="tdBar" />
        </div>

        <div className="teardown__layout container">
          <div className="teardown__left">
            <Reveal as="p" className="eyebrow">
              The Fonology method
            </Reveal>
            <LineMaskHeading
              className="teardown__title"
              lines={[
                'Every repair is',
                <Fragment key="l2">
                  a small <em>surgery.</em>
                </Fragment>,
              ]}
            />

            <div className="td-steps" id="tdSteps">
              {STEPS.map((s, i) => (
                <div
                  className={i === 0 ? 'td-step is-active' : 'td-step'}
                  data-td-step={i}
                  key={s.no}
                >
                  <span className="td-step__no">{s.no}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              ))}
            </div>

            <p className="td-warranty" id="tdWarranty">
              <Spark variant="red" />
              Every part we fit is warrantied — in writing.
            </p>
          </div>

          <div className="teardown__stage" aria-hidden="true">
            <div dangerouslySetInnerHTML={{ __html: TEARDOWN_SVG }} />
            <div className="teardown__labels">
              {LABELS.map((label, i) => (
                <div className="td-label" data-td-label={i} key={i}>
                  <i />
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
