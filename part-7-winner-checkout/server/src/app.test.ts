import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { closeDueAuctions } from './auctionClose.js';

const publishedEvents: Array<{ slug: string; bidId: string }> = [];
const app = buildApp({ publishAuctionChanged: (event) => publishedEvents.push(event) });
let clockNow = new Date('2035-01-01T00:00:00.000Z');
const clockApp = buildApp({ clock: { now: () => new Date(clockNow) } });
const connectionString = process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_7';
const testTitle = 'Vitest liquid cooling manifold';
const bidTestTitle = 'Vitest bid target accelerator';
const concurrencyTestTitle = 'Vitest concurrent bid target';
const clockTestTitle = 'Vitest clock boundary target';
const finalOutcomeTestTitle = 'Vitest final auction outcome';

async function removeTestAuction() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('DELETE FROM auctions WHERE title = ANY($1::text[])', [[
      testTitle,
      bidTestTitle,
      concurrencyTestTitle,
      clockTestTitle,
      finalOutcomeTestTitle,
    ]]);
  } finally {
    await client.end();
  }
}

async function removeConcurrencyDelay() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP TRIGGER IF EXISTS vitest_concurrent_bid_delay ON bids');
    await client.query('DROP FUNCTION IF EXISTS vitest_concurrent_bid_delay()');
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await removeConcurrencyDelay();
  await removeTestAuction();
});
afterAll(async () => {
  await Promise.all([app.close(), clockApp.close()]);
  await removeConcurrencyDelay();
  await removeTestAuction();
});

describe('marketplace read API', () => {
  it('reports a healthy database', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, db: 'ok' });
  });

  it('lists the ten seeded users', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/users' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(10);
    expect(response.json()[0]).toEqual({ id: 1, displayName: 'Avery Chen', handle: 'avery' });
  });

  it('lists all seeded auctions and searches the database-backed catalog', async () => {
    const allResponse = await app.inject({ method: 'GET', url: '/api/auctions' });
    expect(allResponse.statusCode).toBe(200);
    const slugs = allResponse.json().map((auction: { slug: string }) => auction.slug);
    expect(slugs).toEqual(expect.arrayContaining([
      'nvidia-h100-sxm-80gb',
      'amd-epyc-9654',
      'one-point-five-tb-ddr5-ecc',
      'supermicro-4u-gpu-chassis',
      'quantum-2-400g-switch',
      'direct-to-chip-cooling-loop',
    ]));

    const searchResponse = await app.inject({ method: 'GET', url: '/api/auctions?q=memory' });
    expect(searchResponse.statusCode).toBe(200);
    expect(searchResponse.json()).toHaveLength(1);
    expect(searchResponse.json()[0]).toMatchObject({
      slug: 'one-point-five-tb-ddr5-ecc',
      currentPriceCents: 689000,
      bidCount: 0,
    });
  });

  it('returns auction details by slug', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auctions/nvidia-h100-sxm-80gb',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      title: 'NVIDIA H100 SXM 80GB',
      seller: { id: 1, displayName: 'Avery Chen', handle: 'avery' },
      closedAt: null,
      winningBid: null,
    });
  });

  it('returns the authoritative final outcome after the worker closes an auction', async () => {
    const endsAt = new Date(Date.now() + 86_400_000);
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/auctions',
      payload: {
        userId: 10,
        title: finalOutcomeTestTitle,
        category: 'Cooling',
        description: 'A close outcome API test listing with a committed winning bid.',
        condition: 'Bench tested',
        location: 'Madison, WI',
        startingPriceCents: 125000,
        endsAt: endsAt.toISOString(),
      },
    });
    const slug = createResponse.json().slug as string;
    const bidResponse = await app.inject({
      method: 'POST',
      url: `/api/auctions/${slug}/bids`,
      payload: { userId: 9, amountCents: 125100 },
    });
    expect(bidResponse.statusCode).toBe(201);

    const closedAt = new Date();
    const workerPool = new pg.Pool({ connectionString });
    try {
      await workerPool.query('UPDATE auctions SET ends_at = $1 WHERE slug = $2', [closedAt, slug]);
      await closeDueAuctions({ pool: workerPool, now: closedAt });
    } finally {
      await workerPool.end();
    }

    const detail = await app.inject({ method: 'GET', url: `/api/auctions/${slug}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      closedAt: closedAt.toISOString(),
      winningBid: {
        id: bidResponse.json().id,
        amountCents: 125100,
        bidder: { id: 9, displayName: 'Zoe Patel', handle: 'zoe' },
      },
    });
  });

  it('validates and persists a new auction for the active user', async () => {
    const invalidResponse = await app.inject({
      method: 'POST',
      url: '/api/auctions',
      payload: {
        userId: 10,
        title: testTitle,
        category: 'Cooling',
        description: 'A test listing that should be rejected because its closing time has passed.',
        condition: 'Bench tested',
        location: 'Madison, WI',
        startingPriceCents: 125000,
        endsAt: '2020-01-01T00:00:00.000Z',
      },
    });
    expect(invalidResponse.statusCode).toBe(400);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/auctions',
      payload: {
        userId: 10,
        title: testTitle,
        category: 'Cooling',
        description: 'A stainless distribution manifold tested under sustained pressure.',
        condition: 'Bench tested',
        location: 'Madison, WI',
        startingPriceCents: 125000,
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(createResponse.statusCode).toBe(201);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/auctions/${createResponse.json().slug}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      title: testTitle,
      art: 'cooling',
      currentPriceCents: 125000,
      seller: { id: 10, displayName: 'Marcus Green' },
      specs: [],
    });
  });

  it('rejects invalid bidders and amounts, then stores accepted bid history', async () => {
    publishedEvents.length = 0;
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/auctions',
      payload: {
        userId: 10,
        title: bidTestTitle,
        category: 'GPUs',
        description: 'A dedicated accelerator listing used to verify sequential bid behavior.',
        condition: 'Used · Fully tested',
        location: 'Des Moines, IA',
        startingPriceCents: 200000,
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const slug = createResponse.json().slug as string;

    const selfBid = await app.inject({
      method: 'POST', url: `/api/auctions/${slug}/bids`,
      payload: { userId: 10, amountCents: 200100 },
    });
    expect(selfBid.statusCode).toBe(409);
    expect(selfBid.json()).toMatchObject({ code: 'SELLER_CANNOT_BID' });

    const lowBid = await app.inject({
      method: 'POST', url: `/api/auctions/${slug}/bids`,
      payload: { userId: 9, amountCents: 200099 },
    });
    expect(lowBid.statusCode).toBe(409);
    expect(lowBid.json()).toMatchObject({
      code: 'BID_TOO_LOW',
      currentPriceCents: 200000,
      minimumBidCents: 200100,
      endsAt: expect.any(String),
    });
    expect(publishedEvents).toEqual([]);

    const firstBid = await app.inject({
      method: 'POST', url: `/api/auctions/${slug}/bids`,
      payload: { userId: 9, amountCents: 200100 },
    });
    expect(firstBid.statusCode).toBe(201);
    expect(firstBid.json()).toMatchObject({
      amountCents: 200100,
      bidder: { id: 9, displayName: 'Zoe Patel' },
    });
    expect(publishedEvents).toEqual([{ slug, bidId: firstBid.json().id }]);

    const secondBid = await app.inject({
      method: 'POST', url: `/api/auctions/${slug}/bids`,
      payload: { userId: 8, amountCents: 200300 },
    });
    expect(secondBid.statusCode).toBe(201);
    expect(publishedEvents).toEqual([
      { slug, bidId: firstBid.json().id },
      { slug, bidId: secondBid.json().id },
    ]);

    const detail = await app.inject({ method: 'GET', url: `/api/auctions/${slug}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      currentPriceCents: 200300,
      bidCount: 2,
      currentBidder: 'eli',
      bidHistory: [
        { amountCents: 200300, bidder: { id: 8, displayName: 'Eli Martin' } },
        { amountCents: 200100, bidder: { id: 9, displayName: 'Zoe Patel' } },
      ],
    });

    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      await client.query('UPDATE auctions SET ends_at = now() - interval \'1 minute\' WHERE slug = $1', [slug]);
    } finally {
      await client.end();
    }
    const endedBid = await app.inject({
      method: 'POST', url: `/api/auctions/${slug}/bids`,
      payload: { userId: 7, amountCents: 200500 },
    });
    expect(endedBid.statusCode).toBe(409);
    expect(endedBid.json()).toMatchObject({
      code: 'AUCTION_CLOSED',
      error: 'This auction has ended',
      currentPriceCents: 200300,
      minimumBidCents: 200400,
      endsAt: expect.any(String),
    });
    expect(publishedEvents).toHaveLength(2);
  });

  it('serializes concurrent bids and preserves a strictly increasing accepted history', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/auctions',
      payload: {
        userId: 10,
        title: concurrencyTestTitle,
        category: 'GPUs',
        description: 'An accelerator listing used to verify concurrent bid serialization.',
        condition: 'Used · Fully tested',
        location: 'Des Moines, IA',
        startingPriceCents: 300000,
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const slug = createResponse.json().slug as string;

    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      await client.query(`
        CREATE OR REPLACE FUNCTION vitest_concurrent_bid_delay() RETURNS trigger AS $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM auctions
            WHERE id = NEW.auction_id AND title = 'Vitest concurrent bid target'
          ) THEN
            PERFORM pg_sleep(0.1);
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await client.query(`
        CREATE TRIGGER vitest_concurrent_bid_delay
        BEFORE INSERT ON bids
        FOR EACH ROW EXECUTE FUNCTION vitest_concurrent_bid_delay()
      `);

      const equalResponses = await Promise.all([1, 2, 3].map((userId) => app.inject({
        method: 'POST',
        url: `/api/auctions/${slug}/bids`,
        payload: { userId, amountCents: 300100 },
      })));
      expect(equalResponses.filter((response) => response.statusCode === 201)).toHaveLength(1);
      expect(equalResponses.filter((response) => response.statusCode === 409)).toHaveLength(2);
      for (const conflict of equalResponses.filter((response) => response.statusCode === 409)) {
        expect(conflict.json()).toMatchObject({
          code: 'BID_TOO_LOW',
          currentPriceCents: 300100,
          minimumBidCents: 300200,
        });
      }

      const distinctResponses = await Promise.all([
        { userId: 4, amountCents: 300200 },
        { userId: 5, amountCents: 300500 },
        { userId: 6, amountCents: 300300 },
      ].map((payload) => app.inject({
        method: 'POST',
        url: `/api/auctions/${slug}/bids`,
        payload,
      })));
      expect(distinctResponses[1].statusCode).toBe(201);

      const detail = await app.inject({ method: 'GET', url: `/api/auctions/${slug}` });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({ currentPriceCents: 300500, currentBidder: 'jordan' });
      const acceptedAmounts = (detail.json().bidHistory as Array<{ amountCents: number }>)
        .map((bid) => bid.amountCents);
      expect(new Set(acceptedAmounts).size).toBe(acceptedAmounts.length);
      expect(acceptedAmounts).toEqual([...acceptedAmounts].sort((left, right) => right - left));
      for (let index = 1; index < acceptedAmounts.length; index += 1) {
        expect(acceptedAmounts[index - 1] - acceptedAmounts[index]).toBeGreaterThanOrEqual(100);
      }
    } finally {
      await client.query('DROP TRIGGER IF EXISTS vitest_concurrent_bid_delay ON bids');
      await client.query('DROP FUNCTION IF EXISTS vitest_concurrent_bid_delay()');
      await client.end();
    }
  });

  it('checks the injected app clock after locking and stores that exact acceptance time', async () => {
    clockNow = new Date('2035-01-01T00:00:00.000Z');
    const tooSoon = await clockApp.inject({
      method: 'POST',
      url: '/api/auctions',
      payload: {
        userId: 10,
        title: `${clockTestTitle} too soon`,
        category: 'GPUs',
        description: 'An auction used to prove creation also follows the injected clock.',
        condition: 'Used · Fully tested',
        location: 'Des Moines, IA',
        startingPriceCents: 400000,
        endsAt: '2035-01-01T00:01:00.000Z',
      },
    });
    expect(tooSoon.statusCode).toBe(400);

    const endsAt = new Date('2035-01-01T00:10:00.000Z');
    const createResponse = await clockApp.inject({
      method: 'POST',
      url: '/api/auctions',
      payload: {
        userId: 10,
        title: clockTestTitle,
        category: 'GPUs',
        description: 'An accelerator listing used to verify the authoritative app clock.',
        condition: 'Used · Fully tested',
        location: 'Des Moines, IA',
        startingPriceCents: 400000,
        endsAt: endsAt.toISOString(),
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const slug = createResponse.json().slug as string;

    clockNow = new Date('2035-01-01T00:09:00.123Z');
    const accepted = await clockApp.inject({
      method: 'POST',
      url: `/api/auctions/${slug}/bids`,
      payload: { userId: 9, amountCents: 400100 },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({ createdAt: clockNow.toISOString() });

    const blocker = new pg.Client({ connectionString });
    await blocker.connect();
    let transactionOpen = false;
    try {
      await blocker.query('BEGIN');
      transactionOpen = true;
      await blocker.query('SELECT id FROM auctions WHERE slug = $1 FOR UPDATE', [slug]);

      const waitingBid = clockApp.inject({
        method: 'POST',
        url: `/api/auctions/${slug}/bids`,
        payload: { userId: 8, amountCents: 400200 },
      });

      let lockWaitObserved = false;
      for (let attempt = 0; attempt < 50 && !lockWaitObserved; attempt += 1) {
        const waiting = await blocker.query<{ waiting: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity
             WHERE datname = current_database()
               AND pid <> pg_backend_pid()
               AND wait_event_type = 'Lock'
               AND cardinality(pg_blocking_pids(pid)) > 0
           ) AS waiting`,
        );
        lockWaitObserved = waiting.rows[0].waiting;
        if (!lockWaitObserved) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(lockWaitObserved).toBe(true);

      clockNow = new Date(endsAt);
      await blocker.query('COMMIT');
      transactionOpen = false;

      const closed = await waitingBid;
      expect(closed.statusCode).toBe(409);
      expect(closed.json()).toMatchObject({
        code: 'AUCTION_CLOSED',
        currentPriceCents: 400100,
        minimumBidCents: 400200,
        endsAt: endsAt.toISOString(),
      });
    } finally {
      if (transactionOpen) await blocker.query('ROLLBACK');
      await blocker.end();
    }

    const detail = await clockApp.inject({ method: 'GET', url: `/api/auctions/${slug}` });
    expect(detail.json().bidHistory).toHaveLength(1);
    expect(detail.json().bidHistory[0]).toMatchObject({
      amountCents: 400100,
      createdAt: '2035-01-01T00:09:00.123Z',
    });
  });
});
