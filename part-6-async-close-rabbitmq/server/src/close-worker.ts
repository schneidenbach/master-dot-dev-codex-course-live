import './otel.js';
import * as amqp from 'amqplib';
import { closeDueAuctions } from './auctionClose.js';
import { createDatabase } from './db/index.js';
import { ensureAuctionEventTopology, publishPendingOutbox } from './outboxPublisher.js';

const connectionString = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@localhost:55432/auction_part_6';
const rabbitmqUrl = process.env.RABBITMQ_URL ?? 'amqp://auction:auction@localhost:56726';
const { db, pool } = createDatabase(connectionString);
let stopping = false;

function requestStop() {
  stopping = true;
}

process.once('SIGINT', requestStop);
process.once('SIGTERM', requestStop);

const rabbit = await amqp.connect(rabbitmqUrl);
rabbit.on('error', (error) => console.error('Auction Close Worker RabbitMQ error', error));
rabbit.on('close', () => {
  if (!stopping) {
    console.error('Auction Close Worker RabbitMQ connection closed');
    process.exitCode = 1;
    requestStop();
  }
});
const channel = await rabbit.createConfirmChannel();
await ensureAuctionEventTopology(channel);

try {
  while (!stopping) {
    try {
      const now = new Date();
      const closed = await closeDueAuctions({ db, now });
      const published = await publishPendingOutbox({ db, channel, now });
      if (closed.length > 0) {
        console.info(`Closed ${closed.length} auction${closed.length === 1 ? '' : 's'}`);
      }
      if (published.length > 0) {
        console.info(`Published ${published.length} AuctionClosed event${published.length === 1 ? '' : 's'}`);
      }
      if (closed.length > 0 || published.length > 0) continue;
    } catch (error) {
      console.error('Auction close/outbox poll failed; retrying', error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
} finally {
  await channel.close().catch(() => undefined);
  await rabbit.close().catch(() => undefined);
  await pool.end();
}
