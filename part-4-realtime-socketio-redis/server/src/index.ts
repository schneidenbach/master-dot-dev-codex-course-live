import './otel.js';

const { buildApp } = await import('./app.js');
const { createAuctionRealtime } = await import('./realtime.js');
let realtime: ReturnType<typeof createAuctionRealtime>;
const app = buildApp({ publishAuctionChanged: (event) => realtime.publishAuctionChanged(event) });
realtime = createAuctionRealtime(app.server, app.log);
const port = Number(process.env.API_PORT ?? 3104);
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:56379';

try {
  await realtime.connectRedis(redisUrl);
  app.addHook('onClose', async () => realtime.close());
  await app.listen({ port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
