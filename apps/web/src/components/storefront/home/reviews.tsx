'use client';

import { useEffect, useRef } from 'react';
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
            <>
              <em>very nice</em> about us.
            </>,
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
