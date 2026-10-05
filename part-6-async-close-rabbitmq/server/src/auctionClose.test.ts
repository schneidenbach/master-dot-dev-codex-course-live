import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auctionClosedEventSchema, closeDueAuctions } from './auctionClose.js';
import { createDatabase } from './db/index.js';
import { auctionCloses, auctions, bids, outboxEvents } from './db/schema.js';

const connectionString = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@localhost:55432/auction_part_6';
const { db, pool } = createDatabase(connectionString);
const titlePrefix = 'Vitest close worker';

async function removeTestAuctions() {
  await db.delete(auctions).where(like(auctions.title, `${titlePrefix}%`));
}

async function insertAuction({
  suffix,
  endsAt,
  sellerId = 1,
}: {
  suffix: string;
  endsAt: Date;
  sellerId?: number;
}) {
  const [auction] = await db.insert(auctions).values({
    slug: `vitest-close-${suffix}`,
    sellerUserId: sellerId,
    title: `${titlePrefix} ${suffix}`,
    category: 'GPUs',
    art: 'gpu',
    startingPriceCents: 10_000,
    endsAt,
    location: 'Chicago, IL',
    condition: 'Bench tested',
    description: 'A deterministic auction close worker test listing.',
    specs: [],
  }).returning({ id: auctions.id, slug: auctions.slug });
  return auction;
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
    const insertedBids = await db.insert(bids).values([
      {
        auctionId: auction.id,
        bidderUserId: 2,
        amountCents: 10_100,
        createdAt: new Date(deadline.getTime() - 2_000),
      },
      {
        auctionId: auction.id,
        bidderUserId: 3,
        amountCents: 10_400,
        createdAt: new Date(deadline.getTime() - 1_000),
      },
    ]).returning({ id: bids.id });

    const closed = await closeDueAuctions({ db, now: deadline });
    expect(closed).toEqual(expect.arrayContaining([expect.objectContaining({
      auctionId: auction.id.toString(),
      slug: auction.slug,
      winningBidId: insertedBids[1].id.toString(),
    })]));

    const [stored] = await db.select({
      closedAt: auctionCloses.closedAt,
      winningBidId: auctionCloses.winningBidId,
      id: outboxEvents.id,
      payload: outboxEvents.payload,
    })
      .from(auctionCloses)
      .innerJoin(outboxEvents, eq(outboxEvents.auctionId, auctionCloses.auctionId))
      .where(eq(auctionCloses.auctionId, auction.id));
    const payload = auctionClosedEventSchema.parse(stored.payload);
    expect(stored.closedAt.toISOString()).toBe(deadline.toISOString());
    expect(stored.winningBidId).toBe(insertedBids[1].id);
    expect(payload).toMatchObject({
      eventId: stored.id,
      eventType: 'AuctionClosed',
      slug: auction.slug,
      endsAt: deadline.toISOString(),
      closedAt: deadline.toISOString(),
      seller: { id: 1, handle: 'avery' },
      winner: { bidId: insertedBids[1].id.toString(), userId: 3, amountCents: 10_400 },
    });

    await closeDueAuctions({ db, now: new Date(deadline.getTime() + 10_000) });
    expect(await db.$count(auctionCloses, eq(auctionCloses.auctionId, auction.id))).toBe(1);
    expect(await db.$count(outboxEvents, eq(outboxEvents.auctionId, auction.id))).toBe(1);
  });

  it('records a no-bid close with no winner', async () => {
    const now = new Date();
    const auction = await insertAuction({ suffix: 'no-bids', endsAt: new Date(now.getTime() - 1) });

    await closeDueAuctions({ db, now });

    const [stored] = await db.select({
      winningBidId: auctionCloses.winningBidId,
      payload: outboxEvents.payload,
    })
      .from(auctionCloses)
      .innerJoin(outboxEvents, eq(outboxEvents.auctionId, auctionCloses.auctionId))
      .where(eq(auctionCloses.auctionId, auction.id));
    expect(stored.winningBidId).toBeNull();
    expect(auctionClosedEventSchema.parse(stored.payload).winner).toBeNull();
  });

  it('lets competing workers claim disjoint batches without duplicate closes', async () => {
    const now = new Date();
    const created = await Promise.all(Array.from({ length: 8 }, (_, index) => insertAuction({
      suffix: `concurrent-${index}`,
      endsAt: new Date(now.getTime() - 1_000 - index),
      sellerId: (index % 2) + 1,
    })));

    const results = await Promise.all([
      closeDueAuctions({ db, now, batchSize: 4 }),
      closeDueAuctions({ db, now, batchSize: 4 }),
    ]);
    const closedIds = results.flat().map((result) => result.auctionId);
    expect(new Set(closedIds).size).toBe(closedIds.length);
    expect(created.map((auction) => auction.id.toString()))
      .toEqual(expect.arrayContaining(closedIds));

    let closes = 0;
    let events = 0;
    for (let attempt = 0; attempt < 20 && closes < 8; attempt += 1) {
      const auctionIds = created.map((auction) => auction.id);
      closes = await db.$count(auctionCloses, inArray(auctionCloses.auctionId, auctionIds));
      events = await db.$count(outboxEvents, inArray(outboxEvents.auctionId, auctionIds));
      if (closes < 8) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect({ closes, events }).toEqual({ closes: 8, events: 8 });
  });
});
