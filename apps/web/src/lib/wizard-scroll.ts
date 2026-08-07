/**
 * Where a multi-step wizard should scroll to when the step changes.
 *
 * Both the repair and sell flows used to call `scrollTo(0)` on every step —
 * fine on a desktop, where the rail is a sticky sidebar next to the stage and
 * the top of the page IS the question. Below 1023px the layout collapses to
 * one column and the rail stacks ABOVE the stage (storefront.css puts
 * `.wizard__rail` back to `position: static` there), so jumping to 0 landed
 * on the heading, the four rail steps, the price box and the reassurance
 * line — and pushed the next set of cards off the bottom. Every tap meant
 * scrolling back down past all of it.
 *
 * Scrolling the STAGE just under the fixed nav puts the new question on
 * screen instead, forwards and backwards, on both layouts.
 */

/** `--nav-h` from globals.css. Read live so a token change can't desync it. */
function navHeight(): number {
  if (typeof window === 'undefined') return 76;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--nav-h');
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 76;
}

/** Clear of the nav, plus a little air so the step number isn't flush to it. */
export function wizardStageOffset(): number {
  return -(navHeight() + 14);
}
