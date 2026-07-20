import type { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Returns & warranty' };

/** Kept for the footer's existing /returns link — the page is /returns-policy. */
export default function ReturnsPage() {
  permanentRedirect('/returns-policy');
}
