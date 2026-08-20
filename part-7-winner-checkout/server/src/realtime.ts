import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import type { FastifyBaseLogger } from 'fastify';
import { createClient, type RedisClientType } from 'redis';
import { Server } from 'socket.io';
import { z } from 'zod';
import type { OutcomeNotification } from './notificationDelivery.js';

const auctionSubscriptionSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});
const userIdentitySchema = z.object({ userId: z.number().int().positive() });

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
  'user:identify': (
    payload: unknown,
    acknowledge: (result: SubscriptionResult) => void,
  ) => void;
};

type ServerToClientEvents = {
  'auction:changed': (event: AuctionChangedEvent) => void;
  'auction:closed': (event: OutcomeNotification) => void;
};

type SocketData = { userId?: number };

export function auctionRoom(slug: string): string {
  return `auction:${slug}`;
}

export function userRoom(userId: number): string {
  return `user:${userId}`;
}

export type AuctionRealtime = {
  connectRedis(redisUrl: string): Promise<void>;
  publishAuctionChanged(event: AuctionChangedEvent): void;
  publishOutcomeNotification(userId: number, event: OutcomeNotification): void;
  close(): Promise<void>;
};

export function createAuctionRealtime(
  httpServer: HttpServer,
  logger: FastifyBaseLogger,
  { validateUserId = async () => true }: {
    validateUserId?: (userId: number) => Promise<boolean>;
  } = {},
): AuctionRealtime {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
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

    socket.on('user:identify', (payload, acknowledge) => {
      void (async () => {
        const parsed = userIdentitySchema.safeParse(payload);
        if (!parsed.success || !await validateUserId(parsed.data.userId)) {
          acknowledge({ ok: false, error: 'Invalid active user' });
          return;
        }
        const previousUserId = socket.data.userId;
        if (previousUserId && previousUserId !== parsed.data.userId) {
          await socket.leave(userRoom(previousUserId));
        }
        await socket.join(userRoom(parsed.data.userId));
        socket.data.userId = parsed.data.userId;
        acknowledge({ ok: true });
      })().catch((error) => {
        logger.error({ err: error }, 'user socket identity failed');
        acknowledge({ ok: false, error: 'Could not identify active user' });
      });
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

    publishOutcomeNotification(userId, event) {
      io.to(userRoom(userId)).emit('auction:closed', event);
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
