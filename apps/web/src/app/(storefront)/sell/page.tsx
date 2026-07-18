import type { Metadata } from 'next';
import { ScaffoldNotice } from '@/components/shared/scaffold-notice';

export const metadata: Metadata = {
  title: 'Sell your phone',
  description: 'Sell or trade in your old phone at the Fonology counter.',
};

/**
 * Sell / trade-in — NEW page (no prototype reference). The flow and business
 * rules are an OPEN QUESTION for the client — see NOTES.md. Built in a later
 * phase once the trade-in logic is confirmed.
 */
export default function SellPage() {
  return (
    <ScaffoldNotice
      surface="Storefront"
      title="Sell your phone"
      phase="a later phase (flow TBC — see NOTES.md)"
    />
  );
}
