import type { Metadata } from 'next';
import { AccountDashboardView } from '@/components/storefront/account/account-dashboard-view';
import { SlimFooter } from '@/components/storefront/footer';

export const metadata: Metadata = {
  title: 'My account',
  robots: { index: false },
};

export default function AccountPage() {
  return (
    <>
      <AccountDashboardView />
      <SlimFooter />
    </>
  );
}
