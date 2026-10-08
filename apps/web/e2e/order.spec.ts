import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import { png, writeEntry } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.skip(({ isMobile }) => isMobile, 'Needs the server render; one project is enough.');
test.skip(() => Boolean(process.env.LOGBOOK_E2E_ONLINE), 'Stands in for Lulu and Stripe, so it runs on local storage only.');

const QUOTES: Record<string, { bookCents: number; shipping: { level: string; name: string; daysMin: number; daysMax: number; priceCents: number }[] }> = {
  US: { bookCents: 2499, shipping: [{ level: 'MAIL', name: 'OSM BPM', daysMin: 10, daysMax: 13, priceCents: 750 }] },
  AU: {
    bookCents: 2499,
    shipping: [
      { level: 'MAIL', name: 'Australia Post Mail', daysMin: 11, daysMax: 12, priceCents: 1000 },
      { level: 'EXPRESS', name: 'Australia Post Express Post Parcel', daysMin: 6, daysMax: 7, priceCents: 1750 },
    ],
  },
};

/** A real order from "Prepare my book" (local API, no Lulu), opened on its order page. */
async function preparedOrder(page: Page): Promise<string> {
  await writeEntry(page, 'Order me', 'Words for the order test.');
  await page.getByTestId('photo-input').setInputFiles([{ name: 'sunset.png', mimeType: 'image/png', buffer: png([250, 120, 60]) }]);
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.goto('/#/book');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('button', { name: 'Make preview' }).click();
  await expect(page.getByText('Preview ready: 32 pages.')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Prepare my book…' }).click();
  await page.getByRole('dialog', { name: 'Send your book to be printed?' }).getByRole('button', { name: 'Send and prepare' }).click();
  await expect(page.getByText('Your print files are ready: 32 pages.')).toBeVisible({ timeout: 120_000 });
  await page.getByRole('link', { name: 'Check the proof and order →' }).click();
  await expect(page.getByRole('heading', { name: 'Your book order' })).toBeVisible();
  return /#\/order\/([\w-]+)/.exec(page.url())![1]!;
}

/**
 * Lulu and Stripe as the API would relay them: quotes per country, a Checkout URL, then "paid".
 * Every other request, and the rest of each order view, comes from the real API.
 */
async function fakePayments(page: Page, orderId: string) {
  const sent: { path: string; body: unknown }[] = [];
  const mock = { state: 'quoted', quote: null as null | Record<string, unknown>, version: 0 };
  const merge = async (route: Route) => {
    const url = route.request().url().replace(/\/(quote|checkout)$/, '');
    const real = (await (await page.request.get(url, { headers: { authorization: route.request().headers()['authorization']! } })).json()) as Record<string, unknown>;
    const paid = mock.state === 'paid' ? { amountTotalCents: 3499, amountShippingCents: 1000, amountTaxCents: 0, currency: 'usd', shippingLevel: 'MAIL', paidAt: '2026-10-08T00:00:00.000Z' } : null;
    return { ...real, state: mock.state, quote: mock.quote, checkoutUrl: mock.state === 'awaiting_payment' ? 'https://checkout.stripe.com/c/pay/cs_test_x' : null, paid };
  };
  await page.route(`**/api/orders/${orderId}**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() as Record<string, unknown> | null;
    if (route.request().method() === 'POST') sent.push({ path, body });
    if (path.endsWith('/quote')) {
      const country = String(body!['country']);
      mock.quote = { version: ++mock.version, at: new Date().toISOString(), country, ...QUOTES[country] };
      return route.fulfill({ json: await merge(route) });
    }
    if (path.endsWith('/checkout')) {
      mock.state = 'paid';
      // Stripe's success_url: a full page load back on the order page.
      return route.fulfill({ json: { url: `http://localhost:4173/?from=stripe#/order/${orderId}` } });
    }
    return route.fulfill({ json: await merge(route) });
  });
  return { sent, mock };
}

test('order: proof, destination and price, the required check, Stripe, and back', async ({ page }) => {
  test.slow();
  const id = await preparedOrder(page);
  const { sent } = await fakePayments(page, id);
  await page.reload();

  await expect(page.getByText('32 pages, 6 × 9 in premium colour paperback, matte.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the pages (PDF)' })).toBeVisible();
  // en-US: the United States is guessed and priced straight away.
  await expect(page.getByLabel('Country')).toHaveValue('US');
  await expect(page.getByText('Total from $32.49')).toBeVisible();

  await page.getByLabel('Country').selectOption('AU');
  await expect(page.getByText('Australia Post Express Post Parcel')).toBeVisible();
  await expect(page.getByText('6–7 business days')).toBeVisible();
  await expect(page.getByText('Total from $34.99')).toBeVisible();
  await expect(page.getByText(/Any tax is worked out from your address/)).toBeVisible();

  const axe = await new AxeBuilder({ page }).include('.order-page').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  const pay = page.getByRole('button', { name: 'Continue to payment' });
  await expect(pay).toBeDisabled();
  await page.getByLabel(/I've checked the pages and the cover/).check();
  await pay.click();

  await expect(page.getByRole('heading', { name: "Thank you, it's paid" })).toBeVisible();
  await expect(page.getByText('You paid $34.99, including $10.00 shipping.')).toBeVisible();
  // Only the country, the quote version the page showed, where to come back to, and the check.
  expect(sent.map((s) => [s.path.replace(id, 'ID'), s.body])).toEqual([
    ['/api/orders/ID/quote', { country: 'US' }],
    ['/api/orders/ID/quote', { country: 'AU' }],
    ['/api/orders/ID/checkout', { quoteVersion: 2, returnUrl: 'http://localhost:4173/', checked: true }],
  ]);
});

test('order: back from Stripe without paying', async ({ page }) => {
  test.slow();
  const id = await preparedOrder(page);
  const { mock } = await fakePayments(page, id);
  mock.state = 'awaiting_payment';
  mock.quote = { version: 1, at: new Date().toISOString(), country: 'AU', ...QUOTES['AU'] };
  await page.goto(`/#/order/${id}?cancelled=1`);
  await expect(page.getByText('You left the payment page, so nothing was charged.')).toBeVisible();
  await expect(page.getByLabel('Country')).toHaveValue('AU');
  await expect(page.getByText('Total from $34.99')).toBeVisible();
});

test('order: an order from another browser', async ({ page }) => {
  await page.goto('/#/order/ord_not_here');
  await expect(page.getByText("This order isn't saved in this browser.")).toBeVisible();
});
