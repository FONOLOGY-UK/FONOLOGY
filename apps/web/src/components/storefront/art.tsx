/**
 * Inline SVG art, reproduced VERBATIM from the prototype (js/data.js: ART,
 * GLYPHS, REPAIR_ICONS) plus the Fonology spark mark. These are decorative,
 * aria-hidden, and rendered exactly as designed. Kept as raw markup so they
 * match the prototype byte-for-byte; they are trusted, static, first-party
 * assets (never user input), so dangerouslySetInnerHTML is safe here.
 */
import type { ProductArt } from '@/lib/data/types';

const SPARK_PATH = 'M12 0 L14.5 9.5 L24 12 L14.5 14.5 L12 24 L9.5 14.5 L0 12 L9.5 9.5 Z';

/**
 * THE REAL FONOLOGY MARK — the client's own logo, not the spark.
 *
 * WHERE IT CAME FROM
 * Traced from the artwork the client supplied (a JPEG of the mark on white,
 * with a black keyline and a grey offset shadow). Only the RED BODY was
 * traced: at the sizes this is used the keyline is sub-pixel and the shadow
 * reads as mud, and a flat single-colour mark is what lets it inherit its
 * colour from CSS the way the spark did.
 *
 * WHY THE MARK ALONE AND NOT ONE OF THE LOCKUPS
 * The client sent four variants: the mark on its own, the mark over
 * "FONOLOGY", a horizontal lockup, and the wordmark on its own. The header
 * already sets FONOLOGY in the site's own display face next to this, so a
 * lockup would print the word twice — once as artwork, once as type, in two
 * different typefaces, side by side. The mark alone is also the only variant
 * that survives being 17px tall.
 *
 * ASPECT RATIO IS NOT 1:1
 * The viewBox is the mark's own proportions (roughly 1.81:1). A square box
 * would letterbox it and throw away half the height it is given, which is why
 * the nav sizes it by height and lets the width follow.
 */
const MARK_PATH =
  'M64.26 0.00L69.75 0.40L74.56 2.68L78.45 6.83L80.46 11.65L80.72 15.93L79.65 20.35L78.05 23.29L70.68 33.47L70.95 36.55L73.23 39.36L75.77 40.29L77.51 40.29L79.52 39.63L87.15 29.05L89.83 26.51L92.10 25.17L97.19 23.69L102.28 24.10L107.36 26.51L110.04 29.05L112.32 32.93L113.25 36.81L113.12 41.10L112.18 44.18L111.11 46.32L104.02 56.09L104.42 59.84L106.29 62.12L108.70 63.19L111.11 63.19L113.12 62.38L119.81 52.88L121.69 51.00L126.10 48.33L130.92 47.39L133.73 47.52L136.68 48.33L141.63 51.41L144.85 55.96L146.18 61.18L145.65 66.13L143.78 70.28L126.10 94.51L123.43 97.05L120.08 98.93L115.80 100.00L109.77 99.20L104.95 96.39L101.87 92.77L100.13 88.22L100.13 82.06L102.14 77.24L105.89 72.29L105.89 68.81L104.82 66.80L103.08 65.33L101.07 64.66L98.66 64.66L96.79 65.73L76.97 93.31L73.90 96.65L71.75 98.13L68.01 99.60L65.60 100.00L61.04 99.60L56.09 97.32L52.48 93.84L50.20 89.02L49.80 83.67L50.60 80.32L51.94 77.51L72.69 49.00L72.69 46.05L71.89 44.31L70.55 42.84L68.27 41.77L65.19 41.77L63.59 42.84L27.04 93.44L24.36 96.39L19.54 99.20L15.66 100.00L11.11 99.60L8.30 98.53L5.49 96.79L2.68 93.84L1.47 91.83L0.00 87.01L0.40 81.53L1.87 77.91L54.48 5.49L57.03 2.95L59.17 1.61L62.25 0.40L64.26 0.13ZM164.26 69.21L170.15 69.88L175.10 72.56L177.11 74.43L178.98 77.11L180.19 79.79L180.86 83.00L180.59 87.95L178.98 92.10L176.44 95.45L173.09 97.99L169.08 99.60L164.39 100.00L158.90 98.53L155.42 96.25L152.88 93.44L150.87 89.56L150.07 85.68L150.07 83.13L150.87 79.65L153.15 75.37L156.36 72.16L160.37 70.01L164.26 69.34Z';

/** Intrinsic proportions of MARK_PATH — keep in step with its viewBox. */
export const MARK_VIEWBOX = '0 0 180.86 100';

/**
 * The Fonology logo mark. Fill comes from CSS (`.fnl-mark path { fill: ... }`),
 * exactly like the spark it replaces, so it can go red on light and white on
 * dark without a second asset.
 */
export function FonologyMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      className={['fnl-mark', className].filter(Boolean).join(' ')}
      viewBox={MARK_VIEWBOX}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path d={MARK_PATH} />
    </svg>
  );
}

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
