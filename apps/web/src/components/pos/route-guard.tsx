'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { can, type Permission } from '@/lib/permissions.config';
import { useStaffRole, useStaffPermissions } from '@/components/shared/can';
import { useSession } from '@/lib/data/hooks';
import { Button } from '@/components/ui/button';

/**
 * Page-level permission guard for the employee panel (item 8). Reads the
 * viewer's role and permissions.config.ts — flipping a permission in config
 * instantly changes what this allows, no component edits.
 */
export function RouteGuard({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const role = useStaffRole('employee');
  const permissions = useStaffPermissions();
  const { isPending: sessionPending } = useSession();
  // Wait for the session (and the real per-person permission set that comes
  // with it) before deciding — otherwise this briefly falls back to the
  // coarse role map and can flash either a page the viewer doesn't hold, or
  // a false "Manager access" block for one they do.
  if (sessionPending) return null;
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
