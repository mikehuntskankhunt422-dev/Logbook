/**
 * Paying on Stripe's hosted Checkout page in a browser, shared by `stripe:check` (M3) and
 * `lulu:e2e` (M4). Field IDs as found on checkout.stripe.com, 2026-10-08. The address is in
 * Adelaide, so sessions must allow Australia.
 */
import type { Frame, Page } from 'playwright';

export const CARDS = {
  success: '4242 4242 4242 4242',
  decline: '4000 0000 0000 0002',
  '3ds': '4000 0027 6000 3184',
} as const;
export type Card = keyof typeof CARDS;

async function fill(page: Page, selector: string, value: string) {
  const el = page.locator(selector).first();
  if (await el.count()) await el.fill(value);
}

/** Fills Stripe's hosted page. Field IDs as found on checkout.stripe.com, 2026-10-08. */
export async function payOnStripe(page: Page, card: Card) {
  await page.locator('#email').fill('stripe-check@example.com');
  // With more than one payment method enabled, the card form sits behind an accordion item.
  const cardChoice = page.locator('[data-testid="card-accordion-item-button"]');
  if (await cardChoice.count()) await cardChoice.click();
  await page.locator('#cardNumber').fill(CARDS[card]);
  await page.locator('#cardExpiry').fill('12 / 34');
  await page.locator('#cardCvc').fill('123');
  await fill(page, '#billingName', 'Sam Reader');
  await fill(page, '#shippingName', 'Sam Reader');
  await fill(page, '#shippingAddressLine1', '1 King William St');
  await fill(page, '#shippingLocality', 'Adelaide');
  await fill(page, '#shippingPostalCode', '5000');
  const state = page.locator('select#shippingAdministrativeArea');
  if (await state.count()) await state.selectOption('SA');
  await fill(page, '#phoneNumber', '0400 000 000');
  // Link offers to save the details; a test run doesn't want that.
  const save = page.locator('#enableStripePass');
  if ((await save.count()) && (await save.isChecked())) await save.uncheck();
  await page.locator('button[type="submit"], .SubmitButton').first().click();
}

/**
 * Stripe's 3-D Secure test page (testmode-acs.stripe.com) sits in nested iframes; its "Complete"
 * button authenticates. Clicked until the challenge goes away, since an early click can be lost.
 */
export async function completeThreeDs(page: Page) {
  const deadline = Date.now() + 60_000;
  let clicked = 0;
  while (Date.now() < deadline) {
    const acs = (page.frames() as Frame[]).find((f) => f.url().includes('testmode-acs.stripe.com'));
    if (!acs) {
      if (clicked) return;
      await page.waitForTimeout(500);
      continue;
    }
    const button = acs.getByRole('button', { name: /complete/i });
    if (await button.isVisible().catch(() => false)) {
      await page.waitForTimeout(1000);
      await button.click().catch(() => undefined);
      clicked++;
      await page.waitForTimeout(3000);
    } else {
      await page.waitForTimeout(500);
    }
  }
  throw new Error(clicked ? 'The 3-D Secure challenge stayed open after clicking Complete.' : 'No 3-D Secure challenge appeared.');
}
