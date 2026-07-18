import { Archivo, Instrument_Sans, Instrument_Serif } from 'next/font/google';

/**
 * Self-hosted typefaces (identical to the prototype's Google Fonts, but served
 * from our own origin — no third-party request, no layout shift, GDPR-clean for
 * a UK deployment). Exposed as CSS variables consumed by globals.css:
 *   --font-archivo           -> --f-display
 *   --font-instrument-sans   -> --f-body
 *   --font-instrument-serif  -> --f-serif
 *
 * Archivo includes the `wdth` (width) axis so the prototype's `font-stretch`
 * usage renders exactly.
 */
export const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  display: 'swap',
  variable: '--font-archivo',
});

export const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-instrument-sans',
});

export const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-instrument-serif',
});

/** Combined className to put on <html>. */
export const fontVariables = `${archivo.variable} ${instrumentSans.variable} ${instrumentSerif.variable}`;
