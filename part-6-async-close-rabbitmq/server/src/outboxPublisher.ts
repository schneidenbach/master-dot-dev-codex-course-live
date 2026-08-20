import type { Channel, ConfirmChannel } from 'amqplib';
import { asc, inArray, isNull } from 'drizzle-orm';
import { auctionClosedEventSchema } from './auctionClose.js';
import type { Database } from './db/index.js';
import { outboxEvents } from './db/schema.js';

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
export async function publishPendingOutbox({
  db,
  channel,
  now,
  batchSize = 50,
}: {
  db: Database;
  channel: ConfirmChannel;
  now: Date;
  batchSize?: number;
}): Promise<string[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new RangeError('batchSize must be an integer between 1 and 500');
  }

  return db.transaction(async (tx) => {
    const pending = await tx.select({ id: outboxEvents.id, payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt))
      .orderBy(asc(outboxEvents.occurredAt), asc(outboxEvents.id))
      .limit(batchSize)
      .for('update', { skipLocked: true });
    if (pending.length === 0) return [];

    for (const row of pending) {
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

    const eventIds = pending.map((row) => row.id);
    await tx.update(outboxEvents)
      .set({ publishedAt: now })
      .where(inArray(outboxEvents.id, eventIds));
    return eventIds;
  });
}
