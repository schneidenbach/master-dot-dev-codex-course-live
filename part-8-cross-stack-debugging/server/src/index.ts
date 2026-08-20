import './otel.js';
import pg from 'pg';

const { buildApp } = await import('./app.js');
const { createAuctionRealtime } = await import('./realtime.js');
let realtime: ReturnType<typeof createAuctionRealtime>;
const app = buildApp({ publishAuctionChanged: (event) => realtime.publishAuctionChanged(event) });
const connectionString = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@localhost:55432/auction_part_8';
const identityPool = new pg.Pool({ connectionString, connectionTimeoutMillis: 1_000 });
realtime = createAuctionRealtime(app.server, app.log, {
  validateUserId: async (userId) => {
    const result = await identityPool.query('SELECT 1 FROM users WHERE id = $1', [userId]);
    return result.rowCount === 1;
  },
});
const port = Number(process.env.API_PORT ?? 3108);
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:56379';

try {
  await realtime.connectRedis(redisUrl);
  app.addHook('onClose', async () => {
    await realtime.close();
    await identityPool.end();
  });
  await app.listen({ port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
