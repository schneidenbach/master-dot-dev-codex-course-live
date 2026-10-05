import './otel.js';
import { eq } from 'drizzle-orm';
import { createDatabase } from './db/index.js';
import { users } from './db/schema.js';

const { buildApp } = await import('./app.js');
const { createAuctionRealtime } = await import('./realtime.js');
let realtime: ReturnType<typeof createAuctionRealtime>;
const app = buildApp({ publishAuctionChanged: (event) => realtime.publishAuctionChanged(event) });
const connectionString = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@localhost:55432/auction_part_6';
const { db: identityDb, pool: identityPool } = createDatabase(connectionString);
realtime = createAuctionRealtime(app.server, app.log, {
  validateUserId: async (userId) => {
    const result = await identityDb.select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return result.length === 1;
  },
});
const port = Number(process.env.API_PORT ?? 3106);
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
