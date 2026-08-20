import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDueAuctions, type AuctionClosedEvent } from './auctionClose.js';

const connectionString = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@localhost:55432/auction_part_6';
const pool = new pg.Pool({ connectionString });
const titlePrefix = 'Vitest close worker';

async function removeTestAuctions() {
  await pool.query('DELETE FROM auctions WHERE title LIKE $1', [`${titlePrefix}%`]);
}

async function insertAuction({
  suffix,
  endsAt,
  sellerId = 1,
}: {
  suffix: string;
  endsAt: Date;
  sellerId?: number;
}): Promise<{ id: string; slug: string }> {
  const slug = `vitest-close-${suffix}`;
  const result = await pool.query<{ id: string; slug: string }>(
    `INSERT INTO auctions (
       slug, seller_user_id, title, kicker, category, art, starting_price_cents,
       ends_at, location, condition, description, specs
     ) VALUES ($1, $2, $3, '', 'GPUs', 'gpu', 10000, $4,
       'Chicago, IL', 'Bench tested', 'A deterministic auction close worker test listing.',
       '[]'::jsonb)
     RETURNING id::text, slug`,
    [slug, sellerId, `${titlePrefix} ${suffix}`, endsAt],
  );
  return result.rows[0];
}

beforeAll(removeTestAuctions);
afterAll(async () => {
  await removeTestAuctions();
  await pool.end();
});

describe('Auction Close Worker transaction', () => {
  it('closes at the exact deadline, selects the highest committed bid, and creates one outbox event', async () => {
    const deadline = new Date();
    const auction = await insertAuction({ suffix: 'winner', endsAt: deadline });
    const bids = await pool.query<{ id: string }>(
      `INSERT INTO bids (auction_id, bidder_user_id, amount_cents, created_at)
       VALUES ($1, 2, 10100, $2), ($1, 3, 10400, $3)
       RETURNING id::text`,
      [auction.id, new Date(deadline.getTime() - 2_000), new Date(deadline.getTime() - 1_000)],
    );

    const closed = await closeDueAuctions({ pool, now: deadline });
    expect(closed).toEqual(expect.arrayContaining([expect.objectContaining({
      auctionId: auction.id,
      slug: auction.slug,
      winningBidId: bids.rows[1].id,
    })]));

    const stored = await pool.query<{
      closed_at: Date;
      winning_bid_id: string;
      id: string;
      payload: AuctionClosedEvent;
    }>(
      `SELECT close.closed_at, close.winning_bid_id::text, event.id::text, event.payload
       FROM auction_closes close
       JOIN outbox_events event ON event.auction_id = close.auction_id
       WHERE close.auction_id = $1`,
      [auction.id],
    );
    expect(stored.rows[0].closed_at.toISOString()).toBe(deadline.toISOString());
    expect(stored.rows[0].winning_bid_id).toBe(bids.rows[1].id);
    expect(stored.rows[0].payload).toMatchObject({
      eventId: stored.rows[0].id,
      eventType: 'AuctionClosed',
      slug: auction.slug,
      endsAt: deadline.toISOString(),
      closedAt: deadline.toISOString(),
      seller: { id: 1, handle: 'avery' },
      winner: { bidId: bids.rows[1].id, userId: 3, amountCents: 10400 },
    });

    await closeDueAuctions({ pool, now: new Date(deadline.getTime() + 10_000) });
    const counts = await pool.query<{ closes: number; events: number }>(
      `SELECT
         (SELECT count(*)::int FROM auction_closes WHERE auction_id = $1) AS closes,
         (SELECT count(*)::int FROM outbox_events WHERE auction_id = $1) AS events`,
      [auction.id],
    );
    expect(counts.rows[0]).toEqual({ closes: 1, events: 1 });
  });

  it('records a no-bid close with no winner', async () => {
    const now = new Date();
    const auction = await insertAuction({ suffix: 'no-bids', endsAt: new Date(now.getTime() - 1) });

    await closeDueAuctions({ pool, now });

    const stored = await pool.query<{ winning_bid_id: string | null; payload: AuctionClosedEvent }>(
      `SELECT close.winning_bid_id::text, event.payload
       FROM auction_closes close
       JOIN outbox_events event ON event.auction_id = close.auction_id
       WHERE close.auction_id = $1`,
      [auction.id],
    );
    expect(stored.rows[0].winning_bid_id).toBeNull();
    expect(stored.rows[0].payload.winner).toBeNull();
  });

  it('lets competing workers claim disjoint batches without duplicate closes', async () => {
    const now = new Date();
    const auctions = await Promise.all(Array.from({ length: 8 }, (_, index) => insertAuction({
      suffix: `concurrent-${index}`,
      endsAt: new Date(now.getTime() - 1_000 - index),
      sellerId: (index % 2) + 1,
    })));

    const results = await Promise.all([
      closeDueAuctions({ pool, now, batchSize: 4 }),
      closeDueAuctions({ pool, now, batchSize: 4 }),
    ]);
    const closedIds = results.flat().map((result) => result.auctionId);
    expect(new Set(closedIds).size).toBe(closedIds.length);
    expect(auctions.map((auction) => auction.id)).toEqual(expect.arrayContaining(closedIds));

    let stored = { closes: 0, events: 0 };
    for (let attempt = 0; attempt < 20 && stored.closes < 8; attempt += 1) {
      const result = await pool.query<{ closes: number; events: number }>(
        `SELECT
           (SELECT count(*)::int FROM auction_closes close
            JOIN auctions a ON a.id = close.auction_id WHERE a.title LIKE $1) AS closes,
           (SELECT count(*)::int FROM outbox_events event
            JOIN auctions a ON a.id = event.auction_id WHERE a.title LIKE $1) AS events`,
        [`${titlePrefix} concurrent-%`],
      );
      stored = result.rows[0];
      if (stored.closes < 8) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(stored).toEqual({ closes: 8, events: 8 });
  });
});
