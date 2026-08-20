import type { Channel, ConfirmChannel } from 'amqplib';
import pg from 'pg';
import { auctionClosedEventSchema } from './auctionClose.js';

export const auctionEventsExchange = 'auction.events';
export const auctionNotificationsQueue = 'auction.notifications';
export const auctionClosedRoutingKey = 'auction.closed';

export async function ensureAuctionEventTopology(
  channel: Pick<Channel, 'assertExchange' | 'assertQueue' | 'bindQueue'>,
): Promise<void> {
  await channel.assertExchange(auctionEventsExchange, 'direct', { durable: true });
  await channel.assertQueue(auctionNotificationsQueue, { durable: true });
  await channel.bindQueue(
    auctionNotificationsQueue,
    auctionEventsExchange,
    auctionClosedRoutingKey,
  );
}

type OutboxRow = {
  id: string;
  payload: unknown;
};

export async function publishPendingOutbox({
  pool,
  channel,
  now,
  batchSize = 50,
}: {
  pool: pg.Pool;
  channel: ConfirmChannel;
  now: Date;
  batchSize?: number;
}): Promise<string[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new RangeError('batchSize must be an integer between 1 and 500');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pending = await client.query<OutboxRow>(
      `SELECT id::text, payload
       FROM outbox_events
       WHERE published_at IS NULL
       ORDER BY occurred_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [batchSize],
    );
    if (pending.rows.length === 0) {
      await client.query('COMMIT');
      return [];
    }

    for (const row of pending.rows) {
      const event = auctionClosedEventSchema.parse(row.payload);
      channel.publish(
        auctionEventsExchange,
        auctionClosedRoutingKey,
        Buffer.from(JSON.stringify(event)),
        {
          persistent: true,
          contentType: 'application/json',
          messageId: row.id,
          type: event.eventType,
          timestamp: Math.floor(now.getTime() / 1_000),
        },
      );
    }
    await channel.waitForConfirms();

    const eventIds = pending.rows.map((row) => row.id);
    await client.query(
      `UPDATE outbox_events
       SET published_at = $1
       WHERE id = ANY($2::uuid[])`,
      [now, eventIds],
    );
    await client.query('COMMIT');
    return eventIds;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
