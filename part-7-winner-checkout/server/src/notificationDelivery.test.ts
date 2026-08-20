import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDueAuctions, type AuctionClosedEvent } from './auctionClose.js';
import { deliverAuctionOutcome, type OutcomeNotification } from './notificationDelivery.js';

const connectionString = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@localhost:55432/auction_part_7';
const pool = new pg.Pool({ connectionString });
const titlePrefix = 'Vitest notification delivery';

async function removeTestAuctions() {
  await pool.query('DELETE FROM auctions WHERE title LIKE $1', [`${titlePrefix}%`]);
}

async function createCloseEvent(suffix: string, withWinner: boolean): Promise<AuctionClosedEvent> {
  const now = new Date();
  const auction = await pool.query<{ id: string }>(
    `INSERT INTO auctions (
       slug, seller_user_id, title, kicker, category, art, starting_price_cents,
       ends_at, location, condition, description, specs
     ) VALUES ($1, 1, $2, '', 'GPUs', 'gpu', 10000, $3,
       'Chicago, IL', 'Bench tested', 'A deterministic notification delivery test listing.',
       '[]'::jsonb)
     RETURNING id::text`,
    [`vitest-delivery-${suffix}`, `${titlePrefix} ${suffix}`, now],
  );
  if (withWinner) {
    await pool.query(
      `INSERT INTO bids (auction_id, bidder_user_id, amount_cents, created_at)
       VALUES ($1, 2, 10100, $2)`,
      [auction.rows[0].id, new Date(now.getTime() - 1_000)],
    );
  }
  await closeDueAuctions({ pool, now });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await pool.query<{ payload: AuctionClosedEvent }>(
      'SELECT payload FROM outbox_events WHERE auction_id = $1',
      [auction.rows[0].id],
    );
    if (result.rows[0]) return result.rows[0].payload;
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

    const first = await deliverAuctionOutcome({ pool, event, now: new Date(), emit });
    const second = await deliverAuctionOutcome({ pool, event, now: new Date(), emit });

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
      pool,
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
      pool,
      event,
      now: new Date(),
      emit: (_userId, notification) => {
        firstNotificationId = notification.notificationId;
        throw new Error('crashed after socket emit');
      },
    })).rejects.toThrow('crashed after socket emit');

    const retriedIds: string[] = [];
    await deliverAuctionOutcome({
      pool,
      event,
      now: new Date(),
      emit: (_userId, notification) => { retriedIds.push(notification.notificationId); },
    });
    expect(retriedIds).toEqual([firstNotificationId]);
  });
});
