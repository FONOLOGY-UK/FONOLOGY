import type { Metadata } from 'next';
import { LabelsView } from '@/components/admin/labels/labels-view';

export const metadata: Metadata = { title: 'Labels' };

/** Label designer — saveable, printable templates (item 7). */
export default function AdminLabelsPage() {
  return <LabelsView />;
}
