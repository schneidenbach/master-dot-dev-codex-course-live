import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { auctionClosedEventSchema, closeDueAuctions, type AuctionClosedEvent } from './auctionClose.js';
import { createDatabase } from './db/index.js';
import { auctions, bids, outboxEvents } from './db/schema.js';
import { deliverAuctionOutcome, type OutcomeNotification } from './notificationDelivery.js';

const connectionString = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@localhost:55432/auction_part_6';
const { db, pool } = createDatabase(connectionString);
const titlePrefix = 'Vitest notification delivery';

async function removeTestAuctions() {
  await db.delete(auctions).where(like(auctions.title, `${titlePrefix}%`));
}

async function createCloseEvent(suffix: string, withWinner: boolean): Promise<AuctionClosedEvent> {
  const now = new Date();
  const [auction] = await db.insert(auctions).values({
    slug: `vitest-delivery-${suffix}`,
    sellerUserId: 1,
    title: `${titlePrefix} ${suffix}`,
    category: 'GPUs',
    art: 'gpu',
    startingPriceCents: 10_000,
    endsAt: now,
    location: 'Chicago, IL',
    condition: 'Bench tested',
    description: 'A deterministic notification delivery test listing.',
    specs: [],
  }).returning({ id: auctions.id });
  if (withWinner) {
    await db.insert(bids).values({
      auctionId: auction.id,
      bidderUserId: 2,
      amountCents: 10_100,
      createdAt: new Date(now.getTime() - 1_000),
    });
  }
  await closeDueAuctions({ db, now });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [result] = await db.select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.auctionId, auction.id));
    if (result) return auctionClosedEventSchema.parse(result.payload);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Auction close event was not created');
}

beforeAll(removeTestAuctions);
afterAll(async () => {
  await removeTestAuctions();
  await pool.end();
});
describe('idempotent outcome delivery', () => {
  it('creates and emits one stable delivery for the seller and winner', async () => {
    const event = await createCloseEvent('winner', true);
    const emissions: Array<{ userId: number; notification: OutcomeNotification }> = [];
    const emit = vi.fn((userId: number, notification: OutcomeNotification) => {
      emissions.push({ userId, notification });
    });

    const first = await deliverAuctionOutcome({ db, event, now: new Date(), emit });
    const second = await deliverAuctionOutcome({ db, event, now: new Date(), emit });

    expect(first).toHaveLength(2);
    expect(second).toEqual([]);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emissions.map((emission) => emission.userId).sort()).toEqual([1, 2]);
    expect(emissions.map((emission) => emission.notification.recipientRole).sort())
      .toEqual(['seller', 'winner']);
    expect(new Set(emissions.map((emission) => emission.notification.notificationId)).size).toBe(2);
  });

  it('creates only the seller delivery when the auction has no winning bid', async () => {
    const event = await createCloseEvent('no-bids', false);
    const emissions: OutcomeNotification[] = [];

    await deliverAuctionOutcome({
      db,
      event,
      now: new Date(),
      emit: (_userId, notification) => { emissions.push(notification); },
    });

    expect(emissions).toHaveLength(1);
    expect(emissions[0]).toMatchObject({ recipientRole: 'seller', winner: null });
  });

  it('reuses a pending delivery ID after an emission-gap failure', async () => {
    const event = await createCloseEvent('emission-gap', false);
    let firstNotificationId = '';
    await expect(deliverAuctionOutcome({
      db,
      event,
      now: new Date(),
      emit: (_userId, notification) => {
        firstNotificationId = notification.notificationId;
        throw new Error('crashed after socket emit');
      },
    })).rejects.toThrow('crashed after socket emit');

    const retriedIds: string[] = [];
    await deliverAuctionOutcome({
      db,
      event,
      now: new Date(),
      emit: (_userId, notification) => { retriedIds.push(notification.notificationId); },
    });
    expect(retriedIds).toEqual([firstNotificationId]);
  });
});
