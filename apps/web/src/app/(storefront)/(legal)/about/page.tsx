import type { Metadata } from 'next';
import { ContentPlaceholder } from '@/components/storefront/content-placeholder';

export const metadata: Metadata = { title: 'About' };

export default function AboutPage() {
  return (
    <ContentPlaceholder
      eyebrow="The shop"
      title="About Fonology"
      note="The shop's story is the client's to tell — bio, photos and history to come."
    />
  );
}
