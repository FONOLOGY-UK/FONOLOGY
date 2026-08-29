'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Round 5 #11: a table row's actions used to be a row of individual icon
 * buttons squeezed into one cell — fine at two, cramped once a third
 * (inventory's shelf-label button, offered only when the product has a
 * barcode) turned up next to Edit and Restore/Delete. This is the general
 * fix: a single 3-dot trigger, a small dropdown of labelled items.
 *
 * Deliberately NOT built on a Radix primitive — no dropdown-menu package is
 * installed, and pulling one in for a handful of admin tables is a bigger
 * dependency than this earns. Same manual open/close-on-outside-click/
 * Escape pattern already used by the storefront's account menu
 * (components/storefront/account-menu.tsx) — proven, and keeps every
 * "small popover" in this codebase built the same way.
 */

export interface RowAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}

export function RowActionsMenu({ actions, srLabel }: { actions: RowAction[]; srLabel: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={wrapRef}>
      <button
        type="button"
        className="text-muted hover:text-ink hover:bg-secondary rounded-ui inline-flex h-8 w-8 items-center justify-center transition-colors"
        aria-label={srLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className="border-line bg-card absolute right-0 top-full z-20 mt-1 min-w-[160px] overflow-hidden rounded-md border py-1 shadow-lg"
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50',
                action.tone === 'danger'
                  ? 'text-red-deep hover:bg-red-tint'
                  : 'text-ink hover:bg-paper-2/60',
              )}
              onClick={() => {
                setOpen(false);
                action.onClick();
              }}
            >
              <span className="[&_svg]:size-3.5 [&_svg]:shrink-0">{action.icon}</span>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
