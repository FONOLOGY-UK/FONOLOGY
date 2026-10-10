import { expect, type Page } from '@playwright/test';

/** The product page's "+" button and the number beside it. */
export function stepper(page: Page) {
  return {
    up: page.getByRole('button', { name: 'Increase quantity' }),
    num: page.locator('.pdp__buy .qty__num'),
  };
}

/**
 * Raises the product page's quantity to `target`. Each "+" asks the API whether one more fits
 * (the button is disabled while it asks), and a click before React has hydrated does nothing — so
 * wait for the button, click, and repeat until the number reads `target`. One bare click raced on
 * the production build (scripts/rehearsal.mjs) and failed tests a customer would never notice:
 * they would just click again.
 */
export async function stepQuantityTo(page: Page, target: number) {
  const { up, num } = stepper(page);
  await expect(async () => {
    if (Number(await num.innerText()) < target) {
      await expect(up).toBeEnabled({ timeout: 5_000 });
      await up.click();
    }
    await expect(num).toHaveText(String(target), { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}
