import Fastify from 'fastify';
import { io as createClient, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
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
});
