import { expect, test } from '@playwright/test';
import pg from 'pg';
import { closeDueAuctions } from '../server/src/auctionClose.js';

const databaseURL = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@127.0.0.1:55432/auction_part_8';

test('winner declines, cancels, retries, and completes hosted checkout', async ({ page, request }) => {
  const database = new pg.Pool({ connectionString: databaseURL });
  let slug = '';
  await page.addInitScript(() => {
    window.sessionStorage.setItem('auction-house-active-user-id', '9');
  });

  try {
    const created = await request.post('/api/auctions', {
      data: {
        userId: 10,
        title: 'Browser winner checkout GPU',
        category: 'GPUs',
        description: 'A browser protection listing for the complete hosted checkout workflow.',
        condition: 'Used · Fully tested',
        location: 'Chicago, IL',
        startingPriceCents: 50_000,
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(created.status()).toBe(201);
    ({ slug } = await created.json() as { slug: string });
    const bid = await request.post(`/api/auctions/${slug}/bids`, {
      data: { userId: 9, amountCents: 50_100 },
    });
    expect(bid.status()).toBe(201);
    const deadline = new Date();
    await database.query('UPDATE auctions SET ends_at = $1 WHERE slug = $2', [deadline, slug]);
    await closeDueAuctions({ pool: database, now: deadline });

    await page.goto(`/items/${slug}`);
    const checkout = page.getByRole('region', { name: 'Winner checkout' });
    await expect(checkout).toContainText('Payment required');
    await expect(checkout).toContainText('$501');
    const checkoutButton = checkout.locator('.checkout-button');
    await expect(checkoutButton).toHaveText('Complete purchase');

    let releaseRequest!: () => void;
    let requestStarted!: () => void;
    const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
    const intercepted = new Promise<void>((resolve) => { requestStarted = resolve; });
    await page.route(/\/api\/auctions\/[^/]+\/checkout$/, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      requestStarted();
      await requestGate;
      await route.continue();
    });
    await checkoutButton.evaluate((button: HTMLButtonElement) => button.click());
    await intercepted;
    await expect(checkoutButton).toBeDisabled();
    releaseRequest();
    await page.waitForURL('http://127.0.0.1:7108/checkout/**');

    await expect(page.getByText('4242 4242 4242 4242')).toBeVisible();
    await expect(page.getByText('4000 0000 0000 0002')).toBeVisible();
    await page.getByLabel('Card number').fill('4000 0000 0000 0002');
    await page.getByLabel('Expiration').fill('12 / 30');
    await page.getByLabel('CVC').fill('123');
    await page.getByRole('button', { name: 'Pay $501.00' }).click();
    await expect(page.getByRole('alert')).toContainText('declined');

    await page.getByRole('link', { name: 'Cancel' }).click();
    await page.waitForURL(`http://localhost:5108/items/${slug}?checkout=canceled`);
    await expect(page.getByText('Payment was not completed. You can try again.')).toBeVisible();
    await page.getByRole('button', { name: 'Complete purchase' }).click();
    await page.waitForURL('http://127.0.0.1:7108/checkout/**');

    await page.getByLabel('Card number').fill('4242 4242 4242 4242');
    await page.getByLabel('Expiration').fill('12 / 30');
    await page.getByLabel('CVC').fill('123');
    await page.getByRole('button', { name: 'Pay $501.00' }).click();
    await page.waitForURL(`http://localhost:5108/items/${slug}?checkout=success&session_id=cs_test_*`);
    await expect(page.getByRole('region', { name: 'Winner checkout' })).toContainText('Payment received');

    const stored = await database.query<{
      status: string;
      amount_cents: number;
      event_count: number;
    }>(
      `SELECT purchase.status, purchase.amount_cents,
         count(event.id)::int AS event_count
       FROM purchases purchase
       JOIN auctions auction ON auction.id = purchase.auction_id
       LEFT JOIN payment_webhook_events event ON event.purchase_id = purchase.id
       WHERE auction.slug = $1
       GROUP BY purchase.id`,
      [slug],
    );
    expect(stored.rows[0]).toMatchObject({ status: 'paid', amount_cents: 50_100, event_count: 1 });
  } finally {
    if (slug) await database.query('DELETE FROM auctions WHERE slug = $1', [slug]);
    await database.end();
  }
});
