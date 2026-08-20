import Fastify from 'fastify';
import { io as createClient, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { OutcomeNotification } from './notificationDelivery.js';
import { createAuctionRealtime, type AuctionChangedEvent } from './realtime.js';

const sockets: Socket[] = [];
const apps: ReturnType<typeof Fastify>[] = [];

async function connect(url: string): Promise<Socket> {
  const socket = createClient(url, { forceNew: true, transports: ['websocket'] });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

async function watch(socket: Socket, slug: string) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    socket.emit('auction:watch', { slug }, resolve);
  });
}

async function identify(socket: Socket, userId: number) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    socket.emit('user:identify', { userId }, resolve);
  });
}

const outcomeNotification: OutcomeNotification = {
  notificationId: '00000000-0000-4000-8000-000000000001',
  eventId: '00000000-0000-4000-8000-000000000011',
  recipientUserId: 1,
  recipientRole: 'seller',
  slug: 'nvidia-h100-sxm-80gb',
  title: 'NVIDIA H100 SXM 80GB',
  endsAt: '2026-08-20T12:00:00.000Z',
  closedAt: '2026-08-20T12:00:01.000Z',
  winner: null,
};

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect());
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('auction realtime rooms', () => {
  it('delivers an auction change only to watchers in that auction room', async () => {
    const app = Fastify();
    apps.push(app);
    const realtime = createAuctionRealtime(app.server, app.log);
    app.addHook('onClose', async () => realtime.close());
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const matching = await connect(address);
    const other = await connect(address);
    expect(await watch(matching, 'nvidia-h100-sxm-80gb')).toEqual({ ok: true });
    expect(await watch(other, 'amd-epyc-9654')).toEqual({ ok: true });

    const received: AuctionChangedEvent[] = [];
    const unexpected: AuctionChangedEvent[] = [];
    matching.on('auction:changed', (event) => received.push(event));
    other.on('auction:changed', (event) => unexpected.push(event));
    realtime.publishAuctionChanged({ slug: 'nvidia-h100-sxm-80gb', bidId: '42' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(received).toEqual([{ slug: 'nvidia-h100-sxm-80gb', bidId: '42' }]);
    expect(unexpected).toEqual([]);
  });

  it('rejects malformed auction room subscriptions', async () => {
    const app = Fastify();
    apps.push(app);
    const realtime = createAuctionRealtime(app.server, app.log);
    app.addHook('onClose', async () => realtime.close());
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const socket = await connect(address);

    expect(await watch(socket, '../private')).toEqual({
      ok: false,
      error: 'Invalid auction subscription',
    });
  });

  it('targets every socket in a validated user room and moves a socket when its user changes', async () => {
    const app = Fastify();
    apps.push(app);
    const realtime = createAuctionRealtime(app.server, app.log, {
      validateUserId: async (userId) => userId === 1 || userId === 2,
    });
    app.addHook('onClose', async () => realtime.close());
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const firstSession = await connect(address);
    const secondSession = await connect(address);
    const unrelated = await connect(address);
    expect(await identify(firstSession, 1)).toEqual({ ok: true });
    expect(await identify(secondSession, 1)).toEqual({ ok: true });
    expect(await identify(unrelated, 2)).toEqual({ ok: true });

    const firstReceived: OutcomeNotification[] = [];
    const secondReceived: OutcomeNotification[] = [];
    const unrelatedReceived: OutcomeNotification[] = [];
    firstSession.on('auction:closed', (event) => firstReceived.push(event));
    secondSession.on('auction:closed', (event) => secondReceived.push(event));
    unrelated.on('auction:closed', (event) => unrelatedReceived.push(event));
    realtime.publishOutcomeNotification(1, outcomeNotification);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(firstReceived).toEqual([outcomeNotification]);
    expect(secondReceived).toEqual([outcomeNotification]);
    expect(unrelatedReceived).toEqual([]);

    expect(await identify(firstSession, 2)).toEqual({ ok: true });
    realtime.publishOutcomeNotification(1, { ...outcomeNotification, notificationId: '00000000-0000-4000-8000-000000000002' });
    realtime.publishOutcomeNotification(2, { ...outcomeNotification, notificationId: '00000000-0000-4000-8000-000000000003' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(firstReceived.map((event) => event.notificationId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003',
    ]);
    expect(secondReceived.map((event) => event.notificationId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
    expect(unrelatedReceived.map((event) => event.notificationId)).toEqual([
      '00000000-0000-4000-8000-000000000003',
    ]);
  });

  it('rejects an unknown active user without joining its room', async () => {
    const app = Fastify();
    apps.push(app);
    const realtime = createAuctionRealtime(app.server, app.log, {
      validateUserId: async (userId) => userId === 1,
    });
    app.addHook('onClose', async () => realtime.close());
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const socket = await connect(address);

    expect(await identify(socket, 99)).toEqual({ ok: false, error: 'Invalid active user' });
    const received: OutcomeNotification[] = [];
    socket.on('auction:closed', (event) => received.push(event));
    realtime.publishOutcomeNotification(99, outcomeNotification);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(received).toEqual([]);
  });
});
