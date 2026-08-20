import type { ConfirmChannel, Options } from 'amqplib';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDueAuctions } from './auctionClose.js';
import {
  auctionClosedRoutingKey,
  auctionEventsExchange,
  publishPendingOutbox,
} from './outboxPublisher.js';

const connectionString = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@localhost:55432/auction_part_7';
const pool = new pg.Pool({ connectionString });
const titlePrefix = 'Vitest outbox publisher';

async function removeTestAuctions() {
  await pool.query('DELETE FROM auctions WHERE title LIKE $1', [`${titlePrefix}%`]);
}

async function createPendingEvent(suffix: string) {
  const now = new Date();
  const auction = await pool.query<{ id: string }>(
    `INSERT INTO auctions (
       slug, seller_user_id, title, kicker, category, art, starting_price_cents,
       ends_at, location, condition, description, specs
     ) VALUES ($1, 1, $2, '', 'GPUs', 'gpu', 10000, $3,
       'Chicago, IL', 'Bench tested', 'A deterministic outbox publisher test listing.',
       '[]'::jsonb)
     RETURNING id::text`,
    [`vitest-outbox-${suffix}`, `${titlePrefix} ${suffix}`, now],
  );
  await closeDueAuctions({ pool, now });
  const event = await pool.query<{ id: string }>(
    'SELECT id::text FROM outbox_events WHERE auction_id = $1',
    [auction.rows[0].id],
  );
  return event.rows[0].id;
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

    const published = await publishPendingOutbox({ pool, channel: fake.channel, now: publishedAt });

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
    const stored = await pool.query<{ published_at: Date }>(
      'SELECT published_at FROM outbox_events WHERE id = $1',
      [eventId],
    );
    expect(stored.rows[0].published_at.toISOString()).toBe(publishedAt.toISOString());
  });

  it('leaves the event pending when RabbitMQ does not confirm it', async () => {
    const eventId = await createPendingEvent('unconfirmed');
    const fake = fakeChannel(() => Promise.reject(new Error('publisher nack')));

    await expect(publishPendingOutbox({ pool, channel: fake.channel, now: new Date() }))
      .rejects.toThrow('publisher nack');

    const stored = await pool.query<{ published_at: Date | null }>(
      'SELECT published_at FROM outbox_events WHERE id = $1',
      [eventId],
    );
    expect(stored.rows[0].published_at).toBeNull();
  });
});
