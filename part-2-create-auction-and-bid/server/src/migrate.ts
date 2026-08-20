import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_2';
const migrationsUrl = new URL('../migrations/', import.meta.url);
const client = new pg.Client({ connectionString });

await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = (await readdir(migrationsUrl)).filter((file) => file.endsWith('.sql')).sort();
  const applied = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  const appliedFiles = new Set(applied.rows.map((row) => row.filename));
  let count = 0;

  for (const filename of files) {
    if (appliedFiles.has(filename)) continue;
    await client.query('BEGIN');
    try {
      await client.query(await readFile(new URL(filename, migrationsUrl), 'utf8'));
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      count++;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  console.log(`${count} migrations applied`);
} finally {
  await client.end();
}
