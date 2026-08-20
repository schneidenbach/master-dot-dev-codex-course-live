import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import type { FastifyBaseLogger } from 'fastify';
import { createClient, type RedisClientType } from 'redis';
import { Server } from 'socket.io';
import { z } from 'zod';

const auctionSubscriptionSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export type AuctionChangedEvent = {
  slug: string;
  bidId: string;
};

type SubscriptionResult = { ok: true } | { ok: false; error: string };

type ClientToServerEvents = {
  'auction:watch': (
    payload: unknown,
    acknowledge: (result: SubscriptionResult) => void,
  ) => void;
};

type ServerToClientEvents = {
  'auction:changed': (event: AuctionChangedEvent) => void;
};

export function auctionRoom(slug: string): string {
  return `auction:${slug}`;
}

export type AuctionRealtime = {
  connectRedis(redisUrl: string): Promise<void>;
  publishAuctionChanged(event: AuctionChangedEvent): void;
  close(): Promise<void>;
};

export function createAuctionRealtime(
  httpServer: HttpServer,
  logger: FastifyBaseLogger,
): AuctionRealtime {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    serveClient: false,
    transports: ['websocket'],
  });
  let redisClients: [RedisClientType, RedisClientType] | null = null;

  io.on('connection', (socket) => {
    socket.on('auction:watch', (payload, acknowledge) => {
      const parsed = auctionSubscriptionSchema.safeParse(payload);
      if (!parsed.success) {
        acknowledge({ ok: false, error: 'Invalid auction subscription' });
        return;
      }
      socket.join(auctionRoom(parsed.data.slug));
      acknowledge({ ok: true });
    });
  });

  return {
    async connectRedis(redisUrl) {
      const publisher = createClient({ url: redisUrl });
      const subscriber = publisher.duplicate();
      publisher.on('error', (error) => logger.error({ err: error }, 'Redis publisher error'));
      subscriber.on('error', (error) => logger.error({ err: error }, 'Redis subscriber error'));
      await Promise.all([publisher.connect(), subscriber.connect()]);
      io.adapter(createAdapter(publisher, subscriber));
      redisClients = [publisher, subscriber];
      logger.info('Socket.IO Redis backplane connected');
    },

    publishAuctionChanged(event) {
      io.to(auctionRoom(event.slug)).emit('auction:changed', event);
    },

    async close() {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      if (redisClients) {
        await Promise.all(redisClients.map(async (client) => {
          if (client.isOpen) await client.quit();
        }));
      }
    },
  };
}
