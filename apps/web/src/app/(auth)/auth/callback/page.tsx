import type { Metadata } from 'next';
import { GoogleCallbackView } from '@/components/auth/google-callback-view';

export const metadata: Metadata = { title: 'Signing you in…', robots: { index: false } };

export default function GoogleCallbackPage() {
  return <GoogleCallbackView />;
}
