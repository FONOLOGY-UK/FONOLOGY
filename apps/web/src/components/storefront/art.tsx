/**
 * Inline SVG art, reproduced VERBATIM from the prototype (js/data.js: ART,
 * GLYPHS, REPAIR_ICONS) plus the Fonology spark mark. These are decorative,
 * aria-hidden, and rendered exactly as designed. Kept as raw markup so they
 * match the prototype byte-for-byte; they are trusted, static, first-party
 * assets (never user input), so dangerouslySetInnerHTML is safe here.
 */
import type { ProductArt } from '@/lib/data/types';

const SPARK_PATH = 'M12 0 L14.5 9.5 L24 12 L14.5 14.5 L12 24 L9.5 14.5 L0 12 L9.5 9.5 Z';

/** The Fonology star/spark. `variant="red"` fills with the brand red. */
export function Spark({
  className,
  variant,
  style,
}: {
  className?: string;
  variant?: 'red';
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={['spark', variant === 'red' ? 'spark--red' : '', className]
        .filter(Boolean)
        .join(' ')}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={style}
    >
      <path d={SPARK_PATH} />
    </svg>
  );
}

/** Bare spark path for places that supply their own <svg> wrapper/fill. */
export const SPARK_D = SPARK_PATH;

export const PRODUCT_ART: Record<ProductArt, string> = {
  case: `<svg viewBox="0 0 200 200" fill="none" aria-hidden="true"><rect x="62" y="30" width="76" height="140" rx="16" class="a-stroke" stroke-width="4"/><rect x="74" y="44" width="24" height="24" rx="8" class="a-stroke" stroke-width="4"/><circle cx="86" cy="56" r="4" class="a-fill"/><circle cx="100" cy="118" r="26" class="a-accent" stroke-width="4" fill="none" stroke-dasharray="6 8" stroke-linecap="round"/><line x1="46" y1="62" x2="46" y2="90" class="a-stroke" stroke-width="4" stroke-linecap="round"/><line x1="154" y1="76" x2="154" y2="96" class="a-stroke" stroke-width="4" stroke-linecap="round"/></svg>`,
  charger: `<svg viewBox="0 0 200 200" fill="none" aria-hidden="true"><rect x="56" y="56" width="88" height="88" rx="20" class="a-stroke" stroke-width="4"/><rect x="80" y="24" width="10" height="26" rx="4" class="a-fill"/><rect x="110" y="24" width="10" height="26" rx="4" class="a-fill"/><rect x="76" y="86" width="22" height="12" rx="6" class="a-accent-st" stroke-width="4"/><rect x="76" y="108" width="22" height="12" rx="6" class="a-stroke" stroke-width="4"/><path d="M124 82 l-12 20 h12 l-12 20" class="a-accent-st" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  cable: `<svg viewBox="0 0 200 200" fill="none" aria-hidden="true"><path d="M60 36 v34 c0 44 80 32 80 76 v24" class="a-stroke" stroke-width="5" stroke-linecap="round"/><rect x="48" y="18" width="24" height="26" rx="7" class="a-stroke" stroke-width="4"/><rect x="128" y="164" width="24" height="20" rx="7" class="a-accent-st" stroke-width="4"/><path d="M84 84 a10 10 0 1 0 0 .1" class="a-accent-st" stroke-width="4"/><path d="M118 128 a10 10 0 1 0 0 .1" class="a-stroke" stroke-width="4"/></svg>`,
  glass: `<svg viewBox="0 0 200 200" fill="none" aria-hidden="true"><rect x="64" y="28" width="72" height="144" rx="14" class="a-stroke" stroke-width="4"/><path d="M84 60 l40 44 M104 104 l-18 26 M104 104 l24 12" class="a-accent-st" stroke-width="3.5" stroke-linecap="round"/><path d="M136 40 l18 -18 M146 56 l22 -8" class="a-stroke" stroke-width="4" stroke-linecap="round"/></svg>`,
  buds: `<svg viewBox="0 0 200 200" fill="none" aria-hidden="true"><circle cx="76" cy="86" r="26" class="a-stroke" stroke-width="4"/><rect x="66" y="106" width="20" height="40" rx="10" class="a-stroke" stroke-width="4"/><circle cx="130" cy="98" r="26" class="a-accent-st" stroke-width="4"/><rect x="120" y="118" width="20" height="40" rx="10" class="a-accent-st" stroke-width="4"/><path d="M52 40 q10 -14 26 -12 M132 52 q14 -4 22 8" class="a-stroke" stroke-width="4" stroke-linecap="round"/></svg>`,
  bank: `<svg viewBox="0 0 200 200" fill="none" aria-hidden="true"><rect x="52" y="48" width="96" height="120" rx="18" class="a-stroke" stroke-width="4"/><circle cx="100" cy="108" r="30" class="a-accent-st" stroke-width="4" stroke-dasharray="7 9" stroke-linecap="round"/><path d="M104 92 l-12 18 h12 l-12 18" class="a-fill-path" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><rect x="72" y="28" width="56" height="10" rx="5" class="a-fill"/></svg>`,
  stand: `<svg viewBox="0 0 200 200" fill="none" aria-hidden="true"><path d="M70 40 h56 l-14 84 h-56 z" class="a-stroke" stroke-width="4" stroke-linejoin="round"/><path d="M84 124 l-8 36 h64" class="a-stroke" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><line x1="58" y1="160" x2="150" y2="160" class="a-accent-st" stroke-width="5" stroke-linecap="round"/><circle cx="98" cy="78" r="6" class="a-accent"/></svg>`,
  mount: `<svg viewBox="0 0 200 200" fill="none" aria-hidden="true"><rect x="70" y="34" width="60" height="104" rx="12" class="a-stroke" stroke-width="4"/><path d="M56 84 h-16 M144 84 h16" class="a-accent-st" stroke-width="5" stroke-linecap="round"/><path d="M86 150 v14 a14 14 0 0 0 28 0 v-14" class="a-stroke" stroke-width="4" stroke-linecap="round"/><circle cx="100" cy="178" r="7" class="a-accent-st" stroke-width="4"/></svg>`,
  tools: `<svg viewBox="0 0 200 200" fill="none" aria-hidden="true"><path d="M74 26 v96 l12 16 12 -16 V26 z" class="a-stroke" stroke-width="4" stroke-linejoin="round"/><rect x="80" y="40" width="12" height="30" class="a-accent"/><path d="M132 60 a22 22 0 1 1 -10 42 l-14 40 a10 10 0 0 0 18 6" class="a-stroke" stroke-width="4" stroke-linecap="round" fill="none"/></svg>`,
  watch: `<svg viewBox="0 0 200 200" fill="none" aria-hidden="true"><rect x="68" y="64" width="64" height="72" rx="20" class="a-stroke" stroke-width="4"/><path d="M80 64 v-26 h40 v26 M80 136 v26 h40 v-26" class="a-stroke" stroke-width="4" stroke-linejoin="round"/><circle cx="100" cy="100" r="16" class="a-accent-st" stroke-width="4" stroke-dasharray="5 7" stroke-linecap="round"/><circle cx="100" cy="100" r="4" class="a-accent"/></svg>`,
};

export const DEVICE_GLYPHS: Record<string, string> = {
  apple: `<svg viewBox="0 0 64 96" fill="none" aria-hidden="true"><rect x="8" y="4" width="48" height="88" rx="10" class="a-stroke" stroke-width="3"/><rect x="14" y="10" width="18" height="18" rx="6" class="a-accent-st" stroke-width="3"/><circle cx="20" cy="16" r="2.4" class="a-accent"/><circle cx="26" cy="22" r="2.4" class="a-accent"/></svg>`,
  samsung: `<svg viewBox="0 0 64 96" fill="none" aria-hidden="true"><rect x="8" y="4" width="48" height="88" rx="10" class="a-stroke" stroke-width="3"/><circle cx="18" cy="16" r="3" class="a-accent"/><circle cx="18" cy="26" r="3" class="a-accent"/><circle cx="18" cy="36" r="3" class="a-accent"/></svg>`,
  pixel: `<svg viewBox="0 0 64 96" fill="none" aria-hidden="true"><rect x="8" y="4" width="48" height="88" rx="10" class="a-stroke" stroke-width="3"/><rect x="12" y="14" width="40" height="10" rx="5" class="a-accent-st" stroke-width="3"/></svg>`,
  other: `<svg viewBox="0 0 64 96" fill="none" aria-hidden="true"><rect x="8" y="4" width="48" height="88" rx="10" class="a-stroke" stroke-width="3" stroke-dasharray="6 6"/><path d="M26 40 q0 -8 8 -8 t8 8 q0 6 -8 9 v6" class="a-accent-st" stroke-width="3.4" stroke-linecap="round" fill="none"/><circle cx="34" cy="64" r="2.6" class="a-accent"/></svg>`,
};

export const REPAIR_ICONS: Record<string, string> = {
  screen: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="13" y="4" width="22" height="40" rx="5" class="a-stroke" stroke-width="2.6"/><path d="M19 12 l8 10 -5 7 M27 22 l6 4" class="a-accent-st" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  battery: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="6" y="14" width="32" height="20" rx="5" class="a-stroke" stroke-width="2.6"/><rect x="40" y="20" width="4" height="8" rx="2" class="a-fill"/><rect x="11" y="19" width="12" height="10" rx="2.5" class="a-accent"/></svg>`,
  port: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="10" y="18" width="28" height="12" rx="6" class="a-stroke" stroke-width="2.6"/><path d="M24 30 v10 M18 40 h12" class="a-accent-st" stroke-width="2.6" stroke-linecap="round"/><path d="M16 24 h16" class="a-accent-st" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="3 4"/></svg>`,
  'water-damage': `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 6 C24 6 12 20 12 30 a12 12 0 0 0 24 0 C36 20 24 6 24 6 Z" class="a-stroke" stroke-width="2.6" stroke-linejoin="round"/><path d="M20 30 a4 4 0 0 0 4 4" class="a-accent-st" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  'data-recovery': `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><ellipse cx="24" cy="13" rx="14" ry="5" class="a-stroke" stroke-width="2.6"/><path d="M10 13 v14 c0 2.8 6.3 5 14 5 M38 13 v8" class="a-stroke" stroke-width="2.6" stroke-linecap="round"/><path d="M30 40 l6 -6 6 6 M36 34 v-8" class="a-accent-st" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  other: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M6 26 h8 l4 -12 6 22 5 -14 3 4 h10" class="a-accent-st" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

/** Render a product-tile art glyph by key. */
export function ProductArtGlyph({ art, className }: { art: ProductArt; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: PRODUCT_ART[art] ?? '' }} />;
}

/** Render a device brand glyph (repair/sell model cards). */
export function DeviceGlyph({ brand, className }: { brand: string; className?: string }) {
  return (
    <span className={className} dangerouslySetInnerHTML={{ __html: DEVICE_GLYPHS[brand] ?? '' }} />
  );
}

/** Render a repair-type icon. */
export function RepairIcon({ id, className }: { id: string; className?: string }) {
  return (
    <span className={className} dangerouslySetInnerHTML={{ __html: REPAIR_ICONS[id] ?? '' }} />
  );
}
