'use client';

import { useEffect } from 'react';
import { useSession, useShops } from '@/lib/data/hooks';
import {
  ALL_SHOPS_VIEW_ONLY_MESSAGE,
  useAllShopsViewOnly,
  useShopSelection,
} from '@/lib/stores/shop.store';
import { toast } from '@/lib/stores/toast.store';

/**
 * "All shops" = view only (tester change C-4). While the dashboard shows every shop combined, no
 * change can be made anywhere in the admin panel — every create, edit and delete answers
 * "Please select a specific shop first to make changes." and changes nothing.
 *
 * One guard for the whole panel, so a screen added later is covered without touching it:
 *
 *   1. Clicks — a capture-phase listener stops any button, menu item, link-button or switch whose
 *      label starts with a change verb (Add, New, Create, Edit, Delete, Remove, Save, Update …)
 *      BEFORE the page's own handler runs, so no dialog even opens. Marked buttons look disabled
 *      but stay clickable, so the message can show. Read-only actions (search, filters, ranges,
 *      Download PDF, opening a row's menu) are untouched. `data-view-only="allow"` exempts an
 *      element; `data-view-only="block"` blocks one whatever its label.
 *   2. The API client — refuses to send any write from the admin panel (http.adapter.ts).
 *   3. The API — refuses any write that names `shop=all` (server.ts).
 */

const CHANGE = new RegExp(
  '^(\\+\\s*)?(add|new|create|edit|delete|remove|save|update|retire|restore|generate|book|' +
    'set as default|set default|apply|duplicate|upload|mark|refund|archive|enable|disable|' +
    'import|assign|approve|reject|publish|move|change|close the day|record|issue|' +
    'turn off|turn on|confirm|send|one more|one less|one fewer|increase|decrease|adjust)\\b',
  'i',
);
const TARGETS =
  'button, [role="menuitem"], [role="switch"], a[role="button"], input[type="submit"]';

function labelOf(el: Element): string {
  return (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
}

/** Is this element a change the guard must stop? */
function isChange(el: Element): boolean {
  const flag = el.getAttribute('data-view-only');
  if (flag === 'allow') return false;
  if (flag === 'block') return true;
  if (el.closest('[data-view-only="allow"]')) return false;
  if (el.getAttribute('role') === 'switch') return true;
  if (el.getAttribute('type') === 'submit') return true;
  return CHANGE.test(labelOf(el));
}

export function AllShopsViewOnlyGuard() {
  const { data: session } = useSession();
  const selected = useShopSelection((s) => s.selected);
  const staff = session?.kind === 'staff' ? session : null;
  const seesMany = staff !== null && staff.staffRole !== 'employee';
  const { data: shops } = useShops({ enabled: seesMany });
  const setOn = useAllShopsViewOnly((s) => s.set);

  // The EFFECTIVE choice, the same rule as the shop switcher: a remembered shop that has closed
  // falls back to the default, and someone with no shop of their own defaults to All shops.
  const known = selected === 'all' || (shops ?? []).some((s) => s.id === selected);
  const effective = (known ? selected : null) ?? staff?.shopId ?? 'all';
  const on = seesMany && (shops?.length ?? 0) >= 2 && effective === 'all';

  useEffect(() => {
    setOn(on);
    return () => setOn(false);
  }, [on, setOn]);

  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    root.setAttribute('data-all-shops', 'view-only');

    // Mark what is blocked, so it reads as disabled before anyone clicks it.
    const mark = () => {
      for (const el of document.querySelectorAll(TARGETS)) {
        if (isChange(el)) el.setAttribute('data-view-only-blocked', '');
        else el.removeAttribute('data-view-only-blocked');
      }
    };
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(mark);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    mark();

    let lastToast = 0;
    const stop = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest(TARGETS) : null;
      if (!target || !isChange(target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      // One message per burst (pointerdown + click both arrive).
      if (Date.now() - lastToast > 800) {
        lastToast = Date.now();
        toast(ALL_SHOPS_VIEW_ONLY_MESSAGE);
      }
    };
    // pointerdown too: some menus act on pointerdown, before any click.
    window.addEventListener('pointerdown', stop, true);
    window.addEventListener('click', stop, true);
    const stopKeys = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') stop(event);
    };
    window.addEventListener('keydown', stopKeys, true);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', stop, true);
      window.removeEventListener('click', stop, true);
      window.removeEventListener('keydown', stopKeys, true);
      root.removeAttribute('data-all-shops');
      for (const el of document.querySelectorAll('[data-view-only-blocked]')) {
        el.removeAttribute('data-view-only-blocked');
      }
    };
  }, [on]);

  if (!on) return null;
  return (
    <div
      role="status"
      className="border-warning/40 bg-warning/10 text-ink rounded-ui mb-4 border px-4 py-2.5 text-sm"
    >
      <strong>All shops — view only.</strong> {ALL_SHOPS_VIEW_ONLY_MESSAGE}
    </div>
  );
}
