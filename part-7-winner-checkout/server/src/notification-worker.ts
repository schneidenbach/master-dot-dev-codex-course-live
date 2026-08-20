import './otel.js';
import * as amqp from 'amqplib';
import { Emitter } from '@socket.io/redis-emitter';
import pg from 'pg';
import { createClient } from 'redis';
import { auctionClosedEventSchema } from './auctionClose.js';
import { deliverAuctionOutcome } from './notificationDelivery.js';
import {
  auctionNotificationsQueue,
  ensureAuctionEventTopology,
} from './outboxPublisher.js';
import { userRoom } from './realtime.js';

const connectionString = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@localhost:55432/auction_part_7';
const rabbitmqUrl = process.env.RABBITMQ_URL ?? 'amqp://auction:auction@localhost:56726';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:56379';

const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 1_000 });
const redis = createClient({ url: redisUrl });
redis.on('error', (error) => console.error('Notification Redis error', error));
await redis.connect();
const emitter = new Emitter(redis);

const rabbit = await amqp.connect(rabbitmqUrl);
rabbit.on('error', (error) => console.error('Notification RabbitMQ error', error));
const channel = await rabbit.createChannel();
await ensureAuctionEventTopology(channel);
await channel.prefetch(10);

const { consumerTag } = await channel.consume(auctionNotificationsQueue, (message) => {
  if (!message) return;
  void (async () => {
    let input: unknown;
    try {
      input = JSON.parse(message.content.toString('utf8'));
    } catch {
      console.error('Discarding malformed AuctionClosed message');
      channel.ack(message);
      return;
    }
    const parsed = auctionClosedEventSchema.safeParse(input);
    if (!parsed.success) {
      console.error('Discarding invalid AuctionClosed message', parsed.error.flatten());
      channel.ack(message);
      return;
    }

    try {
      await deliverAuctionOutcome({
        pool,
        event: parsed.data,
        now: new Date(),
        emit: (userId, notification) => {
          emitter.to(userRoom(userId)).emit('auction:closed', notification);
        },
      });
      channel.ack(message);
    } catch (error) {
      console.error('Auction outcome delivery failed; requeueing', error);
      channel.nack(message, false, true);
    }
  })();
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await channel.cancel(consumerTag).catch(() => undefined);
  await channel.close().catch(() => undefined);
  await rabbit.close().catch(() => undefined);
  if (redis.isOpen) await redis.quit().catch(() => undefined);
  await pool.end();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
rabbit.on('close', () => {
  if (!shuttingDown) {
    console.error('Notification Worker RabbitMQ connection closed');
    process.exitCode = 1;
    void shutdown();
  }
});
