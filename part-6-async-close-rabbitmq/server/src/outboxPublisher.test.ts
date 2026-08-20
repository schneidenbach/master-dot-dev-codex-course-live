import type { ConfirmChannel, Options } from 'amqplib';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDueAuctions } from './auctionClose.js';
import { createDatabase } from './db/index.js';
import { auctions, outboxEvents } from './db/schema.js';
import {
  auctionClosedRoutingKey,
  auctionEventsExchange,
  publishPendingOutbox,
} from './outboxPublisher.js';

const connectionString = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@localhost:55432/auction_part_6';
const { db, pool } = createDatabase(connectionString);
const titlePrefix = 'Vitest outbox publisher';

async function removeTestAuctions() {
  await db.delete(auctions).where(like(auctions.title, `${titlePrefix}%`));
}

async function createPendingEvent(suffix: string) {
  const now = new Date();
  const [auction] = await db.insert(auctions).values({
    slug: `vitest-outbox-${suffix}`,
    sellerUserId: 1,
    title: `${titlePrefix} ${suffix}`,
    category: 'GPUs',
    art: 'gpu',
    startingPriceCents: 10_000,
    endsAt: now,
    location: 'Chicago, IL',
    condition: 'Bench tested',
    description: 'A deterministic outbox publisher test listing.',
    specs: [],
  }).returning({ id: auctions.id });
  await closeDueAuctions({ db, now });
  const [event] = await db.select({ id: outboxEvents.id })
    .from(outboxEvents)
    .where(eq(outboxEvents.auctionId, auction.id));
  return event.id;
}

function fakeChannel(waitForConfirms: () => Promise<void>) {
  const published: Array<{
    exchange: string;
    routingKey: string;
    body: Buffer;
    options?: Options.Publish;
  }> = [];
  return {
    channel: {
      publish: (exchange: string, routingKey: string, body: Buffer, options?: Options.Publish) => {
        published.push({ exchange, routingKey, body, options });
        return true;
      },
      waitForConfirms,
    } as unknown as ConfirmChannel,
    published,
  };
}

beforeAll(removeTestAuctions);
afterAll(async () => {
  await removeTestAuctions();
  await pool.end();
});

describe('transactional outbox publisher', () => {
  it('uses a persistent AuctionClosed message and marks it published only after confirmation', async () => {
    const eventId = await createPendingEvent('confirmed');
    const waitForConfirms = vi.fn().mockResolvedValue(undefined);
    const fake = fakeChannel(waitForConfirms);
    const publishedAt = new Date();

    const published = await publishPendingOutbox({ db, channel: fake.channel, now: publishedAt });

    expect(published).toContain(eventId);
    expect(waitForConfirms).toHaveBeenCalledOnce();
    const message = fake.published.find((candidate) => candidate.options?.messageId === eventId);
    expect(message).toMatchObject({
      exchange: auctionEventsExchange,
      routingKey: auctionClosedRoutingKey,
      options: { persistent: true, contentType: 'application/json', type: 'AuctionClosed' },
    });
    expect(JSON.parse(message?.body.toString('utf8') ?? '{}')).toMatchObject({
      eventId,
      eventType: 'AuctionClosed',
    });
    const [stored] = await db.select({ publishedAt: outboxEvents.publishedAt })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));
    expect(stored.publishedAt?.toISOString()).toBe(publishedAt.toISOString());
  });

  it('leaves the event pending when RabbitMQ does not confirm it', async () => {
    const eventId = await createPendingEvent('unconfirmed');
    const fake = fakeChannel(() => Promise.reject(new Error('publisher nack')));

    await expect(publishPendingOutbox({ db, channel: fake.channel, now: new Date() }))
      .rejects.toThrow('publisher nack');

    const [stored] = await db.select({ publishedAt: outboxEvents.publishedAt })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));
    expect(stored.publishedAt).toBeNull();
  });
});
