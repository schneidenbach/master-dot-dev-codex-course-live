import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './db/index.js';

const connectionString = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@localhost:55432/auction_part_6';
const migrationsFolder = fileURLToPath(new URL('../migrations/', import.meta.url));
const { db, pool } = createDatabase(connectionString);

try {
  await migrate(db, { migrationsFolder });
  console.log('Drizzle migrations applied');
} finally {
  await pool.end();
}
