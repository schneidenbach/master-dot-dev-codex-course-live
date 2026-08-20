import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(
  connectionString: string,
  { connectionTimeoutMillis = 1_000 }: { connectionTimeoutMillis?: number } = {},
): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis });
  return {
    db: drizzle({ client: pool, schema }),
    pool,
  };
}
