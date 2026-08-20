import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import pg from 'pg';
import { closeDueAuctions } from '../server/src/auctionClose.js';

const databaseURL = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@127.0.0.1:55432/auction_part_8';

async function openAs(browser: Browser, userId: number, url: string): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  const context = await browser.newContext();
  await context.addInitScript((selectedUser: number) => {
    window.sessionStorage.setItem('auction-house-active-user-id', String(selectedUser));
  }, userId);
  const page = await context.newPage();
  await page.goto(url);
  return { context, page };
}

test('seller converges from awaiting payment to paid while unrelated users see nothing', async ({ browser, request }) => {
  const database = new pg.Pool({ connectionString: databaseURL });
  const sessions: Array<{ context: BrowserContext; page: Page }> = [];
  let slug = '';
  try {
    const endsAt = new Date(Date.now() + 120_000);
    const created = await request.post('/api/auctions', {
      data: {
        userId: 10,
        title: 'Browser seller payment visibility GPU',
        category: 'GPUs',
        description: 'A browser protection listing for role-limited seller payment state.',
        condition: 'Used · Fully tested',
        location: 'Chicago, IL',
        startingPriceCents: 50_000,
        endsAt: endsAt.toISOString(),
      },
    });
    ({ slug } = await created.json() as { slug: string });
    await request.post(`/api/auctions/${slug}/bids`, {
      data: { userId: 9, amountCents: 50_100 },
    });
    await closeDueAuctions({ pool: database, now: new Date(endsAt.getTime() + 1_000) });

    const itemUrl = `http://localhost:5108/items/${slug}`;
    const [seller, winner, unrelated] = await Promise.all([
      openAs(browser, 10, itemUrl),
      openAs(browser, 9, itemUrl),
      openAs(browser, 8, itemUrl),
    ]);
    sessions.push(seller, winner, unrelated);

    const sellerStatus = seller.page.getByRole('region', { name: 'Winner payment status' });
    await expect(sellerStatus).toContainText('Awaiting payment');
    await expect(sellerStatus).not.toContainText('$501');
    await expect(unrelated.page.getByRole('region', { name: 'Winner payment status' })).toHaveCount(0);
    await expect(unrelated.page.getByRole('region', { name: 'Winner checkout' })).toHaveCount(0);

    await winner.page.getByRole('region', { name: 'Winner checkout' })
      .getByRole('button', { name: 'Complete purchase' }).click();
    await winner.page.waitForURL('http://127.0.0.1:7108/checkout/**');
    await winner.page.getByLabel('Card number').fill('4242 4242 4242 4242');
    await winner.page.getByLabel('Expiration').fill('12 / 30');
    await winner.page.getByLabel('CVC').fill('123');
    await winner.page.getByRole('button', { name: 'Pay $501.00' }).click();
    await expect(winner.page.getByRole('region', { name: 'Winner checkout' })).toContainText('Payment received');
    await expect(sellerStatus).toContainText('Paid', { timeout: 5_000 });
    await expect(sellerStatus).toContainText('The winning bidder completed payment.');
  } finally {
    await Promise.all(sessions.map(({ context }) => context.close()));
    if (slug) await database.query('DELETE FROM auctions WHERE slug = $1', [slug]);
    await database.end();
  }
});
