import { expect, test } from '@playwright/test';
import pg from 'pg';

const databaseURL = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@127.0.0.1:55432/auction_part_7';

test('due auctions converge to authoritative winner and no-bid outcomes', async ({ page, request }) => {
  const database = new pg.Pool({ connectionString: databaseURL });
  const slugs: string[] = [];
  await page.addInitScript(() => {
    window.sessionStorage.setItem('auction-house-active-user-id', '8');
  });

  async function createAuction(title: string) {
    const response = await request.post('/api/auctions', {
      data: {
        userId: 10,
        title,
        category: 'GPUs',
        description: 'A browser protection listing for the asynchronous close workflow.',
        condition: 'Used · Fully tested',
        location: 'Chicago, IL',
        startingPriceCents: 50_000,
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(response.status()).toBe(201);
    const { slug } = await response.json() as { slug: string };
    slugs.push(slug);
    return slug;
  }

  try {
    const winnerSlug = await createAuction('Browser close outcome GPU');
    const bid = await request.post(`/api/auctions/${winnerSlug}/bids`, {
      data: { userId: 9, amountCents: 50_100 },
    });
    expect(bid.status()).toBe(201);
    await database.query(
      'UPDATE auctions SET ends_at = $1 WHERE slug = $2',
      [new Date(Date.now() + 1_500), winnerSlug],
    );

    await page.goto(`/items/${winnerSlug}`);
    await expect(page.getByRole('heading', { name: 'Browser close outcome GPU' })).toBeVisible();
    const winnerOutcome = page.locator('.auction-outcome');
    await expect(winnerOutcome).toContainText('Final outcome', { timeout: 7_000 });
    await expect(winnerOutcome).toContainText('@zoe won with $501');
    await expect(page.locator('.current-price > span')).toHaveText('Final price');
    await expect(page.locator('.bid-guidance')).toHaveText('Bidding has ended.');

    const noBidSlug = await createAuction('Browser no-bid close GPU');
    await database.query(
      'UPDATE auctions SET ends_at = $1 WHERE slug = $2',
      [new Date(Date.now() + 1_500), noBidSlug],
    );

    await page.goto(`/items/${noBidSlug}`);
    const noBidOutcome = page.locator('.auction-outcome');
    await expect(noBidOutcome).toContainText('Final outcome', { timeout: 7_000 });
    await expect(noBidOutcome).toContainText('Ended without bids');
    await expect(page.locator('.current-price > span')).toHaveText('Final price');
  } finally {
    await database.query('DELETE FROM auctions WHERE slug = ANY($1::text[])', [slugs]);
    await database.end();
  }
});
