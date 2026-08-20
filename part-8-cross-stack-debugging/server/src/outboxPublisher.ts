import type { Channel, ConfirmChannel } from 'amqplib';
import { context, SpanKind, SpanStatusCode, type Context, type Span } from '@opentelemetry/api';
import pg from 'pg';
import { auctionClosedEventSchema } from './auctionClose.js';
import {
  contextFromTraceparent,
  startBusinessSpan,
  traceHeaders,
} from './tracing.js';

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
  traceparent: string | null;
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
  const publishSpans: Array<{ span: Span; activeContext: Context }> = [];
  try {
    await client.query('BEGIN');
    const pending = await client.query<OutboxRow>(
      `SELECT id::text, payload, traceparent
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
      const started = startBusinessSpan('auction.closed.publish', {
        'auction.id': event.auctionId,
        'auction.slug': event.slug,
        'messaging.destination.name': auctionEventsExchange,
        'messaging.message.id': row.id,
        'messaging.operation.name': 'publish',
      }, contextFromTraceparent(row.traceparent), SpanKind.PRODUCER);
      publishSpans.push(started);
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
          headers: traceHeaders(started.activeContext),
        },
      );
    }
    await context.with(publishSpans[0].activeContext, () => channel.waitForConfirms());

    const eventIds = pending.rows.map((row) => row.id);
    await context.with(publishSpans[0].activeContext, () => client.query(
      `UPDATE outbox_events
       SET published_at = $1
       WHERE id = ANY($2::uuid[])`,
      [now, eventIds],
    ));
    await client.query('COMMIT');
    for (const { span } of publishSpans) span.end();
    return eventIds;
  } catch (error) {
    for (const { span } of publishSpans) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
