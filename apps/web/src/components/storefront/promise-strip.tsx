import { Reveal } from '@/components/storefront/reveal';

/**
 * The prototype's three-point promise block (Fitted Free Forever /
 * Bench-Tested Stock / 30-Day No-Quibble). Shared by the shop page and the PDP
 * trust strip (6.2). Return window default is 30 days (see NOTES / 6.7).
 */
const POINTS = [
  {
    no: '01',
    title: 'Fitted free, forever',
    body: 'Buy a screen protector here and we’ll fit it perfectly at the counter — today and every replacement after.',
  },
  {
    no: '02',
    title: 'Bench-tested stock',
    body: 'Chargers get load-tested, cables get bend-tested, cases get drop-tested. The failures never make the shelf.',
  },
  {
    no: '03',
    title: '30-day no-quibble',
    body: 'Changed your mind? Bring it back within 30 days. We’d rather have your trust than your twelve quid.',
  },
];

export function PromiseStrip() {
  return (
    <section className="promise">
      <div className="promise__grid container">
        {POINTS.map((p) => (
          <Reveal className="promise__item" key={p.no}>
            <span className="promise__no">{p.no}</span>
            <h3>{p.title}</h3>
            <p>{p.body}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
