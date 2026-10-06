'use client';

import { TradeInsView } from '@/components/admin/tradeins/tradeins-view';
import { useTillShop } from './use-till-shop';

/** The till's payouts screen; the link to website sell requests only at the hub's till. */
export function PosBuyInsView() {
  const { isHub } = useTillShop();
  return <TradeInsView compact basePath="/pos/trade-ins" showRequestsLink={isHub === true} />;
}
