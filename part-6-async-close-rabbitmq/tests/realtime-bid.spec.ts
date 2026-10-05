import { expect, test, type BrowserContext, type Page, type WebSocket } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../server/src/db/index.js';
import { auctions } from '../server/src/db/schema.js';

const baseURL = 'http://localhost:5106';
const databaseURL = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@127.0.0.1:55432/auction_part_6';

async function createBidderPage(
  context: BrowserContext,
  userId: number,
): Promise<Page> {
  await context.addInitScript((activeUserId: number) => {
    window.sessionStorage.setItem('auction-house-active-user-id', String(activeUserId));
  }, userId);
  return context.newPage();
}

async function openSubscribedAuction(page: Page, url: string) {
  const subscription = new Promise<void>((resolve) => {
    const observeSocket = (websocket: WebSocket) => {
      if (!websocket.url().includes('/socket.io/')) return;
      websocket.on('framereceived', (frame: { payload: string | Buffer }) => {
        const payload = typeof frame.payload === 'string'
          ? frame.payload
          : frame.payload.toString('utf8');
        if (payload.includes('"ok":true')) {
          page.off('websocket', observeSocket);
          resolve();
        }
      });
    };
    page.on('websocket', observeSocket);
  });
  await page.goto(url);
  await page.getByRole('heading', { name: 'Realtime browser test GPU' }).waitFor();
  await subscription;
}

test('an accepted bid refreshes every open watcher without a page reload', async ({ browser, request }) => {
  const { db, pool } = createDatabase(databaseURL);
  const createResponse = await request.post('/api/auctions', {
    data: {
      userId: 10,
      title: 'Realtime browser test GPU',
      category: 'GPUs',
      description: 'A dedicated listing used to verify live auction detail updates.',
      condition: 'Used · Fully tested',
      location: 'Chicago, IL',
      startingPriceCents: 50_000,
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  expect(createResponse.status()).toBe(201);
  const { slug } = await createResponse.json() as { slug: string };
  const auctionURL = `${baseURL}/items/${slug}`;
  const bidderContext = await browser.newContext();
  const watcherContext = await browser.newContext();

  try {
    const bidder = await createBidderPage(bidderContext, 9);
    const watcher = await createBidderPage(watcherContext, 8);
    await Promise.all([
      openSubscribedAuction(bidder, auctionURL),
      openSubscribedAuction(watcher, auctionURL),
    ]);
    expect(await watcher.locator('.current-price strong').textContent()).toBe('$500');

    await bidder.getByLabel('Your bid').fill('501.00');
    await bidder.getByRole('button', { name: 'Place bid' }).click();
    await expect(bidder.getByText('Bid accepted — you are the highest bidder.')).toBeVisible();

    await expect(watcher.locator('.current-price strong')).toHaveText('$501');
    await expect(watcher.locator('.current-price small')).toHaveText('1 bid');
    await expect(watcher.locator('.bidder strong')).toHaveText('@zoe');
    await expect(watcher.locator('.bid-guidance')).toHaveText('Minimum bid $502');
    await expect(watcher.locator('.bid-history-list article')).toHaveCount(1);
    await expect(watcher.locator('.bid-history-list article').first()).toContainText('Zoe Patel');
    await expect(watcher.locator('.bid-history-list article').first()).toContainText('$501');
  } finally {
    await Promise.all([bidderContext.close(), watcherContext.close()]);
    await db.delete(auctions).where(eq(auctions.slug, slug));
    await pool.end();
  }
});
