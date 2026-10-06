'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ShieldAlert, Store } from 'lucide-react';
import { can, type Permission } from '@/lib/permissions.config';
import { useStaffRole, useStaffPermissions } from '@/components/shared/can';
import { useSession } from '@/lib/data/hooks';
import { Button } from '@/components/ui/button';
import { useTillShop } from './use-till-shop';

/**
 * Page-level permission guard for the employee panel (item 8). Reads the
 * viewer's role and permissions.config.ts — flipping a permission in config
 * instantly changes what this allows, no component edits.
 *
 *  also keeps a page to the hub shop's till — online repair and sell requests are
 * handled there only (bug report v1, BUG-003). Typing the address at another shop's till lands
 * here instead. The API already scopes those lists and requests to the caller's shop; this is
 * the screen agreeing with it.
 */
export function RouteGuard({
  permission,
  shops,
  children,
}: {
  permission: Permission;
  shops?: 'hub';
  children: ReactNode;
}) {
  const role = useStaffRole('employee');
  const permissions = useStaffPermissions();
  const { isPending: sessionPending } = useSession();
  const { isHub } = useTillShop();
  // Wait for the session (and the real per-person permission set that comes
  // with it) before deciding — otherwise this briefly falls back to the
  // coarse role map and can flash either a page the viewer doesn't hold, or
  // a false "Manager access" block for one they do.
  if (sessionPending) return null;
  if (shops === 'hub') {
    if (isHub === undefined) return null;
    if (!isHub) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center px-6">
          <div className="border-line bg-card max-w-sm rounded-lg border p-8 text-center">
            <Store className="text-muted mx-auto mb-3 size-6" aria-hidden="true" />
            <p className="font-display text-ink text-lg font-extrabold uppercase">Main shop only</p>
            <p className="text-muted mt-1 text-sm">
              Repair and sell requests from the website are handled at the main shop, not at this
              till.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href="/pos">Back to checkout</Link>
            </Button>
          </div>
        </div>
      );
    }
  }
  if (can(role, permission, permissions)) return <>{children}</>;
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="border-line bg-card max-w-sm rounded-lg border p-8 text-center">
        <ShieldAlert className="text-muted mx-auto mb-3 size-6" aria-hidden="true" />
        <p className="font-display text-ink text-lg font-extrabold uppercase">Manager access</p>
        <p className="text-muted mt-1 text-sm">
          This area isn’t available on the counter account. Ask a manager if you need something from
          it.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link href="/pos">Back to checkout</Link>
        </Button>
      </div>
    </div>
  );
}
