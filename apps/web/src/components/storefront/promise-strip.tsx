import { Reveal } from '@/components/storefront/reveal';

/**
 * The prototype's three-point promise block (Fitted Free Forever /
 * Bench-Tested Stock / No-Quibble Returns). Shared by the shop page and the PDP
 * trust strip (6.2).
 *
 * THE RETURNS NUMBER IS A PROP, NOT A CONSTANT.
 *
 * It used to read "30-day no-quibble" as a hardcoded string, which is the same
 * bug that was already found and fixed on the till receipt: an owner setting 14
 * days in Settings while the customer-facing copy still promised 30. It was
 * worse here than on the receipt, because product-detail.tsx renders BOTH this
 * strip and its own returns accordion — so a single product page showed the
 * customer two different return windows the moment the setting was not 30.
 *
 * When the window is not known yet (details still loading, or the API
 * unreachable on a server render) the point renders WITHOUT a number rather
 * than falling back to 30. Same rule as receipt.tsx: no number is better than a
 * wrong one, because the customer holds you to the number.
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
];

export function PromiseStrip({ returnWindowDays }: { returnWindowDays: number | null }) {
  const points = [
    ...POINTS,
    {
      no: '03',
      title: returnWindowDays != null ? `${returnWindowDays}-day no-quibble` : 'No-quibble returns',
      body:
        returnWindowDays != null
          ? `Changed your mind? Bring it back within ${returnWindowDays} days. We’d rather have your trust than your twelve quid.`
          : 'Changed your mind? Bring it back for a refund or exchange. We’d rather have your trust than your twelve quid.',
    },
  ];

  return (
    <section className="promise">
      <div className="promise__grid container">
        {points.map((p) => (
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
