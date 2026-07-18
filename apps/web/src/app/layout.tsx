import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import { fontVariables } from '@/lib/fonts';
import { QueryProvider } from '@/components/providers/query-provider';
import { Toaster } from '@/components/ui/toaster';

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23E8250C' d='M12 0 L14.5 9.5 L24 12 L14.5 14.5 L12 24 L9.5 14.5 L0 12 L9.5 9.5 Z'/%3E%3C/svg%3E";

export const metadata: Metadata = {
  metadataBase: new URL('https://fonology.co.uk'),
  title: {
    default: 'Fonology — Cracked. Fixed. Same day.',
    template: '%s — Fonology',
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
