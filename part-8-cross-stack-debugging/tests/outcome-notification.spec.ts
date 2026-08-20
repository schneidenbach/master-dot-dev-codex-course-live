import * as amqp from 'amqplib';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type WebSocket,
} from '@playwright/test';
import pg from 'pg';

const databaseURL = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@127.0.0.1:55432/auction_part_8';
const rabbitmqURL = process.env.RABBITMQ_URL ?? 'amqp://auction:auction@127.0.0.1:56726';

async function openUserSession(
  browser: Browser,
  userId: number,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await context.addInitScript((activeUserId: number) => {
    window.sessionStorage.setItem('auction-house-active-user-id', String(activeUserId));
  }, userId);
  const page = await context.newPage();
  const identified = new Promise<void>((resolve) => {
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
  await page.goto('/');
  await identified;
  return { context, page };
}

test('RabbitMQ close event opens one role-specific modal in every online recipient session', async ({ browser, request }) => {
  const database = new pg.Pool({ connectionString: databaseURL });
  const sessions: Array<{ context: BrowserContext; page: Page }> = [];
  let slug = '';

  try {
    const createResponse = await request.post('/api/auctions', {
      data: {
        userId: 10,
        title: 'Browser outcome notification GPU',
        category: 'GPUs',
        description: 'A browser protection listing for the RabbitMQ notification workflow.',
        condition: 'Used · Fully tested',
        location: 'Chicago, IL',
        startingPriceCents: 50_000,
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(createResponse.status()).toBe(201);
    ({ slug } = await createResponse.json() as { slug: string });
    const bidResponse = await request.post(`/api/auctions/${slug}/bids`, {
      data: { userId: 9, amountCents: 50_100 },
    });
    expect(bidResponse.status()).toBe(201);

    const [seller, winnerOne, winnerTwo, unrelated] = await Promise.all([
      openUserSession(browser, 10),
      openUserSession(browser, 9),
      openUserSession(browser, 9),
      openUserSession(browser, 8),
    ]);
    sessions.push(seller, winnerOne, winnerTwo, unrelated);

    await database.query(
      'UPDATE auctions SET ends_at = $1 WHERE slug = $2',
      [new Date(Date.now() + 1_500), slug],
    );

    const sellerModal = seller.page.getByRole('dialog');
    await expect(sellerModal).toContainText('Your auction has closed', { timeout: 8_000 });
    await expect(sellerModal).toContainText(
      'Your auction for Browser outcome notification GPU ended. Zoe Patel won with $501.',
    );
    for (const winner of [winnerOne, winnerTwo]) {
      const modal = winner.page.getByRole('dialog');
      await expect(modal).toContainText('Congratulations');
      await expect(modal).toContainText(
        'You won Browser outcome notification GPU with a bid of $501.',
      );
      await expect(modal.getByRole('button', { name: 'Complete purchase' })).toBeVisible();
    }
    await expect(sellerModal.getByRole('button', { name: 'Complete purchase' })).toHaveCount(0);
    await expect(unrelated.page.getByRole('dialog')).toHaveCount(0);

    const deliveryState = await database.query<{
      payload: unknown;
      published_at: Date | null;
      delivery_count: number;
      emitted_count: number;
    }>(
      `SELECT event.payload, event.published_at,
         count(delivery.id)::int AS delivery_count,
         count(delivery.emitted_at)::int AS emitted_count
       FROM outbox_events event
       JOIN auctions a ON a.id = event.auction_id
       LEFT JOIN notification_deliveries delivery ON delivery.outbox_event_id = event.id
       WHERE a.slug = $1
       GROUP BY event.id`,
      [slug],
    );
    expect(deliveryState.rows[0]).toMatchObject({
      published_at: expect.any(Date),
      delivery_count: 2,
      emitted_count: 2,
    });

    await winnerOne.page.getByRole('button', { name: 'Dismiss' }).click();
    await winnerTwo.page.getByRole('button', { name: 'Dismiss' }).click();
    await seller.page.getByRole('link', { name: 'View auction' }).click();
    await expect(seller.page).toHaveURL(new RegExp(`/items/${slug}$`));
    await expect(seller.page.getByRole('heading', { name: 'Browser outcome notification GPU' }))
      .toBeVisible();

    const rabbit = await amqp.connect(rabbitmqURL);
    const channel = await rabbit.createConfirmChannel();
    try {
      channel.publish(
        'auction.events',
        'auction.closed',
        Buffer.from(JSON.stringify(deliveryState.rows[0].payload)),
        { persistent: true, contentType: 'application/json' },
      );
      await channel.waitForConfirms();
    } finally {
      await channel.close();
      await rabbit.close();
    }
    await seller.page.waitForTimeout(750);
    await expect(seller.page.getByRole('dialog')).toHaveCount(0);
    await expect(winnerOne.page.getByRole('dialog')).toHaveCount(0);
    await expect(winnerTwo.page.getByRole('dialog')).toHaveCount(0);
  } finally {
    await Promise.all(sessions.map(({ context }) => context.close()));
    if (slug) await database.query('DELETE FROM auctions WHERE slug = $1', [slug]);
    await database.end();
  }
});
