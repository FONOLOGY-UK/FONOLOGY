import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import { fontVariables } from '@/lib/fonts';
import { QueryProvider } from '@/components/providers/query-provider';
import { Toaster } from '@/components/ui/toaster';

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 180.86 180.86'%3E%3Cg transform='translate(0,40.43)'%3E%3Cpath fill='%23E8250C' d='M64.26 0.00L69.75 0.40L74.56 2.68L78.45 6.83L80.46 11.65L80.72 15.93L79.65 20.35L78.05 23.29L70.68 33.47L70.95 36.55L73.23 39.36L75.77 40.29L77.51 40.29L79.52 39.63L87.15 29.05L89.83 26.51L92.10 25.17L97.19 23.69L102.28 24.10L107.36 26.51L110.04 29.05L112.32 32.93L113.25 36.81L113.12 41.10L112.18 44.18L111.11 46.32L104.02 56.09L104.42 59.84L106.29 62.12L108.70 63.19L111.11 63.19L113.12 62.38L119.81 52.88L121.69 51.00L126.10 48.33L130.92 47.39L133.73 47.52L136.68 48.33L141.63 51.41L144.85 55.96L146.18 61.18L145.65 66.13L143.78 70.28L126.10 94.51L123.43 97.05L120.08 98.93L115.80 100.00L109.77 99.20L104.95 96.39L101.87 92.77L100.13 88.22L100.13 82.06L102.14 77.24L105.89 72.29L105.89 68.81L104.82 66.80L103.08 65.33L101.07 64.66L98.66 64.66L96.79 65.73L76.97 93.31L73.90 96.65L71.75 98.13L68.01 99.60L65.60 100.00L61.04 99.60L56.09 97.32L52.48 93.84L50.20 89.02L49.80 83.67L50.60 80.32L51.94 77.51L72.69 49.00L72.69 46.05L71.89 44.31L70.55 42.84L68.27 41.77L65.19 41.77L63.59 42.84L27.04 93.44L24.36 96.39L19.54 99.20L15.66 100.00L11.11 99.60L8.30 98.53L5.49 96.79L2.68 93.84L1.47 91.83L0.00 87.01L0.40 81.53L1.87 77.91L54.48 5.49L57.03 2.95L59.17 1.61L62.25 0.40L64.26 0.13ZM164.26 69.21L170.15 69.88L175.10 72.56L177.11 74.43L178.98 77.11L180.19 79.79L180.86 83.00L180.59 87.95L178.98 92.10L176.44 95.45L173.09 97.99L169.08 99.60L164.39 100.00L158.90 98.53L155.42 96.25L152.88 93.44L150.87 89.56L150.07 85.68L150.07 83.13L150.87 79.65L153.15 75.37L156.36 72.16L160.37 70.01L164.26 69.34Z'/%3E%3C/g%3E%3C/svg%3E";

export const metadata: Metadata = {
  metadataBase: new URL('https://fonology.co.uk'),
  title: {
    default: 'Fonology | Cracked. Fixed. Same day.',
    template: '%s | Fonology',
  },
  description:
    'Fonology — the UK high-street phone repair counter. Screens, batteries and charging ports fixed same-day, plus accessories tested at our own bench.',
  icons: { icon: FAVICON },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F2F0EC',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={fontVariables} suppressHydrationWarning>
      <body>
        <QueryProvider>
          {children}
          <Toaster />
        </QueryProvider>
      </body>
    </html>
  );
}
