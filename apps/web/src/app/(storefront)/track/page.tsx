import type { Metadata } from 'next';
import { ScaffoldNotice } from '@/components/shared/scaffold-notice';

export const metadata: Metadata = {
  title: 'Track your repair or order',
  description: 'Enter your Fonology reference to track a repair booking or a shop order.',
};

/** Public tracking — resolves a reference to a booking or order. Built in Phase 2. */
export default function TrackPage() {
  return (
    <ScaffoldNotice surface="Storefront" title="Track" phase="Phase 2 — storefront reproduction" />
  );
}
