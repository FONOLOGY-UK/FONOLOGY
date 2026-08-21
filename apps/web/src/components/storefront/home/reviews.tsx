'use client';

import { Fragment, useEffect, useRef } from 'react';
import { gsap, registerGsap } from '@/lib/gsap';
import { useReviews } from '@/lib/data/hooks/use-reviews';
import type { Review } from '@/lib/data/types';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { LineMaskHeading, Reveal } from '@/components/storefront/reveal';

const STARS = '★★★★★';

function ReviewCard({ r }: { r: Review }) {
  return (
    <article className="rev">
      <div className="rev__stars">{STARS}</div>
      <p className="rev__text">“{r.text}”</p>
      <div className="rev__who">
        <strong>{r.name}</strong>
        <i />
        <span>{r.device}</span>
      </div>
    </article>
  );
}

export function Reviews() {
  const { reduced, ready } = useEnvironment();
  const { data: reviews } = useReviews();
  const rowsRef = useRef<HTMLDivElement>(null);

  const list = reviews ?? [];
  const half = Math.ceil(list.length / 2);
  const rows = [list.slice(0, half), list.slice(half)];
  const hasReviews = list.length > 0;

  useEffect(() => {
    if (!ready || reduced || !reviews) return;
    registerGsap();
    const root = rowsRef.current;
    if (!root) return;
    const tweens = gsap.utils.toArray<HTMLElement>('.revrow', root).map((row) => {
      const dir = parseInt(row.dataset.dir || '-1', 10);
      const tween = gsap.fromTo(
        row,
        { xPercent: dir === 1 ? -50 : 0 },
        { xPercent: dir === 1 ? 0 : -50, ease: 'none', repeat: -1, duration: 46 },
      );
      const slow = () => gsap.to(tween, { timeScale: 0.15, duration: 0.6 });
      const fast = () => gsap.to(tween, { timeScale: 1, duration: 0.6 });
      row.addEventListener('mouseenter', slow);
      row.addEventListener('mouseleave', fast);
      return { tween, row, slow, fast };
    });
    return () => {
      tweens.forEach(({ tween, row, slow, fast }) => {
        row.removeEventListener('mouseenter', slow);
        row.removeEventListener('mouseleave', fast);
        tween.kill();
      });
    };
  }, [ready, reduced, reviews]);

  /**
   * Nothing to show -> show nothing.
   *
   * WHY THIS GUARD EXISTS
   * `listReviews()` is `notImplemented` in the HTTP adapter — there is no
   * reviews table, no API endpoint, and no Google Places integration anywhere
   * in this repo. Reviews only ever existed as static copy inside the MOCK
   * adapter. So against the real API this section rendered its heading
   * ("Strangers being very nice about us") above two empty marquee rows: a
   * 414px hole on the homepage, under a title promising testimonials.
   *
   * An empty section is worse than no section, so it returns null instead.
   *
   * WHAT IT IS DELIBERATELY NOT DOING
   * It is NOT falling back to the mock adapter's testimonials. Those names and
   * quotes are invented, and publishing invented customer reviews on a real
   * UK shop's website is not a style choice — the Digital Markets, Competition
   * and Consumers Act 2024 makes submitting or commissioning fake consumer
   * reviews, and hosting them without taking reasonable steps, a banned
   * practice. Filling this section from the mock data would have made the hole
   * disappear and replaced it with a legal problem.
   *
   * To turn this back on, one of two things has to happen, and both are the
   * client's decision (HANDOVER-PROJECT.md section 8, question 5): pull real
   * reviews from the Google Places API with the shop's own Place ID, or build
   * a reviews table fed by verified customers. Until then the honest claim is
   * the one the hero already makes — the real 4.9 rating and 900+ count.
   */
  if (!hasReviews) return null;

  return (
    <section className="reviews" id="reviews">
      <div className="reviews__head container">
        <Reveal as="p" className="eyebrow">
          Word of mouth
        </Reveal>
        <LineMaskHeading
          className="reviews__title"
          lines={[
            'Strangers being',
            <Fragment key="l2">
              <em>very nice</em> about us.
            </Fragment>,
          ]}
        />
      </div>
      <div className="reviews__rows" ref={rowsRef}>
        {rows.map((rowList, i) => (
          <div className="revrow" data-dir={i % 2 ? 1 : -1} key={i}>
            {rowList.concat(rowList).map((r, j) => (
              <ReviewCard r={r} key={`${r.id}-${j}`} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
